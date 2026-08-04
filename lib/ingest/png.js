/**
 * Minimal PNG decoder — Node builtins only (zlib).
 *
 * Exists so brandkit can sample real pixels out of screenshots without taking
 * an image dependency. Screenshots are the one piece of evidence that cannot
 * lie about what a site actually looks like: a stylesheet says what was
 * declared, a screenshot says what was painted.
 *
 * Supports the shapes screenshot tooling actually emits: bit depth 8 or 16,
 * color types 0/2/3/4/6, non-interlaced. Adam7 interlacing is rejected with a
 * clear reason rather than decoded incorrectly.
 */
var fs = require('fs');
var zlib = require('zlib');

var SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Budget on bytes, not pixels. Peak cost is raw + unfiltered + rgba, which
// depends on channels and sample size: an 8-bit RGB screenshot costs 10
// bytes/px while 16-bit RGBA costs 20. A flat pixel cap either admits a 1GB
// decode or rejects tall full-page captures that are entirely reasonable.
var MAX_DECODE_BYTES = 600e6;

/** Channels per pixel, by PNG color type. */
var CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decode(buf) {
  for (var i = 0; i < 8; i++) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  }

  var meta = null;
  var palette = null;
  var trns = null;
  var idat = [];
  var pos = 8;

  while (pos < buf.length) {
    var len = buf.readUInt32BE(pos);
    var type = buf.toString('ascii', pos + 4, pos + 8);
    var data = buf.slice(pos + 8, pos + 8 + len);
    pos += 12 + len; // length + type + data + crc

    if (type === 'IHDR') {
      meta = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12]
      };
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (!meta) throw new Error('no IHDR chunk');
  if (meta.interlace) throw new Error('interlaced PNG not supported');
  if (!CHANNELS[meta.colorType]) throw new Error('unsupported color type ' + meta.colorType);
  if (meta.depth !== 8 && meta.depth !== 16) {
    throw new Error('unsupported bit depth ' + meta.depth);
  }
  if (!idat.length) throw new Error('no IDAT data');

  var channels = CHANNELS[meta.colorType];
  var bytesPerSample = meta.depth / 8;

  var pixels = meta.width * meta.height;
  var peakBytes = pixels * channels * bytesPerSample * 2 + pixels * 4 + meta.height;
  if (peakBytes > MAX_DECODE_BYTES) {
    throw new Error('image too large to decode (' + meta.width + 'x' + meta.height +
      ', ~' + Math.round(peakBytes / 1e6) + 'MB)');
  }

  var bpp = channels * bytesPerSample;              // bytes per pixel
  var stride = meta.width * bpp;                    // bytes per scanline (no filter byte)
  var expected = meta.height * (stride + 1);        // + 1 filter byte per scanline

  // Bound the inflate: IDAT contents need not honor the declared dimensions,
  // so a small file can otherwise expand without limit. `generate --from` walks
  // arbitrary downloaded archives, which makes this reachable.
  var raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: expected });

  // A short stream would otherwise read `undefined` past the end, and
  // `undefined & 0xff` is 0 — a truncated screenshot would quietly decode as
  // black and be reported as a genuine brand surface.
  if (raw.length < expected) {
    throw new Error('truncated image data (' + raw.length + ' of ' + expected + ' bytes)');
  }

  var unfiltered = unfilter(raw, meta.height, stride, bpp);
  return toRGBA(unfiltered, meta, channels, bytesPerSample, palette, trns);
}

/**
 * Reverse the per-scanline filters. Each scanline in the inflated stream is
 * prefixed with a filter-type byte; types 1-4 reference the pixel to the left
 * (`a`) and/or the scanline above (`b`), so this must run top to bottom.
 */
function unfilter(raw, height, stride, bpp) {
  var out = Buffer.alloc(height * stride);
  var pos = 0;

  for (var y = 0; y < height; y++) {
    var filter = raw[pos++];
    var rowStart = y * stride;
    var prevStart = rowStart - stride;

    for (var x = 0; x < stride; x++) {
      var value = raw[pos + x];
      var a = x >= bpp ? out[rowStart + x - bpp] : 0;
      var b = y > 0 ? out[prevStart + x] : 0;
      var c = (x >= bpp && y > 0) ? out[prevStart + x - bpp] : 0;

      switch (filter) {
        case 0: break;                                   // None
        case 1: value = value + a; break;                // Sub
        case 2: value = value + b; break;                // Up
        case 3: value = value + ((a + b) >> 1); break;    // Average
        case 4: value = value + paeth(a, b, c); break;    // Paeth
        default: throw new Error('bad filter type ' + filter + ' on row ' + y);
      }
      out[rowStart + x] = value & 0xff;
    }
    pos += stride;
  }
  return out;
}

/** Scale an 8-bit sample back to the 16-bit space tRNS keys are stored in. */
function scaleUp(sample, maxSample) {
  return maxSample === 255 ? sample : sample * 257;
}

function paeth(a, b, c) {
  var p = a + b - c;
  var pa = Math.abs(p - a);
  var pb = Math.abs(p - b);
  var pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Normalize any supported color type to 8-bit RGBA. */
function toRGBA(data, meta, channels, bytesPerSample, palette, trns) {
  var count = meta.width * meta.height;
  var rgba = Buffer.alloc(count * 4);

  // tRNS for non-palette images is a single fully-transparent color key:
  // 2 bytes (grayscale) or 6 bytes (truecolor), each sample big-endian.
  var keyGray = (meta.colorType === 0 && trns && trns.length >= 2) ? trns.readUInt16BE(0) : null;
  var keyRGB = (meta.colorType === 2 && trns && trns.length >= 6)
    ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
  var maxSample = meta.depth === 16 ? 65535 : 255;

  for (var i = 0; i < count; i++) {
    // 16-bit samples are truncated to their high byte — ample for color
    // sampling. Indexed inline rather than through a closure: a per-pixel
    // closure allocates millions of times on a full-page screenshot.
    var src = i * channels * bytesPerSample;
    var s0 = data[src];
    var s1 = data[src + bytesPerSample];
    var s2 = data[src + bytesPerSample * 2];
    var s3 = data[src + bytesPerSample * 3];
    var r, g, b, a = 255;

    switch (meta.colorType) {
      case 0:                                                    // grayscale
        r = g = b = s0;
        if (keyGray !== null && scaleUp(s0, maxSample) === keyGray) a = 0;
        break;
      case 4: r = g = b = s0; a = s1; break;                     // grayscale + alpha
      case 2:                                                    // truecolor
        r = s0; g = s1; b = s2;
        if (keyRGB && scaleUp(r, maxSample) === keyRGB[0] &&
            scaleUp(g, maxSample) === keyRGB[1] &&
            scaleUp(b, maxSample) === keyRGB[2]) a = 0;
        break;
      case 6: r = s0; g = s1; b = s2; a = s3; break;             // truecolor + alpha
      case 3:                                                    // palette
        var idx = s0;
        if (!palette || idx * 3 + 2 >= palette.length) { r = g = b = 0; break; }
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
        if (trns && idx < trns.length) a = trns[idx];
        break;
    }

    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }

  return { width: meta.width, height: meta.height, pixels: rgba };
}

/**
 * Most-frequent colors, counted on a strided sample.
 *
 * Exact counting (no quantization) on purpose: web pages are built from large
 * flat fills, so the true surface and brand colors dominate honestly, while
 * quantization would smear distinct brand hues into one another. Fully
 * transparent pixels are skipped.
 */
function gcd(a, b) { while (b) { var t = b; b = a % b; a = t; } return a; }

/**
 * A stride that walks every column, not the same few forever.
 *
 * Row-major sampling with a step that divides the width samples the identical
 * column set on every row: at width 1200, step 12, only 100 of 1200 columns
 * are ever visited. A narrow vertical element — a button, a logo, a rule —
 * lands in the blind spot and reads as absent from the page, which is exactly
 * the signal used to reject a token. Forcing the step coprime with the width
 * makes the sampled column cycle through all of them.
 */
function sampleStep(total, width, target) {
  var step = Math.max(1, Math.floor(total / target));
  if (step === 1) return 1;
  var guard = 0;
  while (gcd(step, width) !== 1 && guard++ < width) step++;
  return step;
}

function dominantColors(img, opts) {
  opts = opts || {};
  var want = opts.top || 8;
  var target = opts.samples || 200000;
  var total = img.width * img.height;
  var step = sampleStep(total, img.width, target);

  var counts = Object.create(null);
  var sampled = 0;

  for (var i = 0; i < total; i += step) {
    var o = i * 4;
    if (img.pixels[o + 3] < 8) continue; // effectively transparent
    var key = (img.pixels[o] << 16) | (img.pixels[o + 1] << 8) | img.pixels[o + 2];
    counts[key] = (counts[key] || 0) + 1;
    sampled++;
  }

  return Object.keys(counts)
    .sort(function (a, b) { return counts[b] - counts[a]; })
    .slice(0, want)
    .map(function (key) {
      var n = Number(key);
      return {
        hex: '#' + ('000000' + n.toString(16)).slice(-6).toUpperCase(),
        count: counts[key],
        share: sampled ? counts[key] / sampled : 0
      };
    });
}

/**
 * Fraction of sampled pixels within `tolerance` of a given hex.
 *
 * This is the check that catches a fabricated token: a color a tool claims is
 * the brand's secondary, but which is effectively absent from every rendered
 * page, is not a brand color.
 */
function presence(img, hex, tolerance) {
  var t = tolerance == null ? 14 : tolerance;
  var m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  var n = parseInt(m[1], 16);
  var tr = (n >> 16) & 0xff, tg = (n >> 8) & 0xff, tb = n & 0xff;

  var total = img.width * img.height;
  var step = sampleStep(total, img.width, 200000);
  var hits = 0, sampled = 0;

  for (var i = 0; i < total; i += step) {
    var o = i * 4;
    if (img.pixels[o + 3] < 8) continue;
    sampled++;
    if (Math.abs(img.pixels[o] - tr) < t &&
        Math.abs(img.pixels[o + 1] - tg) < t &&
        Math.abs(img.pixels[o + 2] - tb) < t) hits++;
  }

  return { hits: hits, sampled: sampled, share: sampled ? hits / sampled : 0 };
}

/** Decode from disk. Returns null (never throws) so a bad file can't fail a run. */
function readFile(file) {
  try {
    return decode(fs.readFileSync(file));
  } catch (_) {
    return null;
  }
}

module.exports = {
  decode: decode,
  readFile: readFile,
  dominantColors: dominantColors,
  presence: presence
};
