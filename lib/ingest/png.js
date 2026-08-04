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
var MAX_PIXELS = 50e6; // ~200MB as RGBA; a full-page screenshot is well under

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
  if (meta.width * meta.height > MAX_PIXELS) {
    throw new Error('image too large (' + meta.width + 'x' + meta.height + ')');
  }
  if (!idat.length) throw new Error('no IDAT data');

  var raw = zlib.inflateSync(Buffer.concat(idat));
  var channels = CHANNELS[meta.colorType];
  var bytesPerSample = meta.depth / 8;
  var bpp = channels * bytesPerSample;              // bytes per pixel
  var stride = meta.width * bpp;                    // bytes per scanline (no filter byte)

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

  for (var i = 0; i < count; i++) {
    var src = i * channels * bytesPerSample;
    // 16-bit samples are truncated to their high byte — ample for color sampling.
    var s = function (n) { return data[src + n * bytesPerSample]; };
    var r, g, b, a = 255;

    switch (meta.colorType) {
      case 0: r = g = b = s(0); break;                          // grayscale
      case 4: r = g = b = s(0); a = s(1); break;                 // grayscale + alpha
      case 2: r = s(0); g = s(1); b = s(2); break;               // truecolor
      case 6: r = s(0); g = s(1); b = s(2); a = s(3); break;     // truecolor + alpha
      case 3:                                                    // palette
        var idx = s(0);
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
function dominantColors(img, opts) {
  opts = opts || {};
  var want = opts.top || 8;
  var target = opts.samples || 200000;
  var total = img.width * img.height;
  var step = Math.max(1, Math.floor(total / target));

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
  var step = Math.max(1, Math.floor(total / 200000));
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
