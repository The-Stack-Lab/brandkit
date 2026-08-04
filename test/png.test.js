/**
 * Build synthetic PNGs exercising the color-type / bit-depth paths that the
 * real screenshot corpus (all 8-bit truecolor) never touched, then decode them
 * with lib/ingest/png.js and assert exact pixel values.
 */
var zlib = require('zlib');
var png = require('../lib/ingest/png');

function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  // The decoder skips CRCs, so zeros are fine for fixtures.
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

function ihdr(w, h, depth, colorType, interlace) {
  var d = Buffer.alloc(13);
  d.writeUInt32BE(w, 0); d.writeUInt32BE(h, 4);
  d[8] = depth; d[9] = colorType; d[10] = 0; d[11] = 0; d[12] = interlace || 0;
  return chunk('IHDR', d);
}

/** rows: array of Buffers (raw scanline bytes, no filter byte); filter applied per row. */
function build(w, h, depth, colorType, rows, opts) {
  opts = opts || {};
  var parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  parts.push(ihdr(w, h, depth, colorType, opts.interlace));
  if (opts.plte) parts.push(chunk('PLTE', opts.plte));
  if (opts.trns) parts.push(chunk('tRNS', opts.trns));

  var raw = [];
  rows.forEach(function (row, i) {
    var f = opts.filters ? opts.filters[i] : 0;
    raw.push(Buffer.concat([Buffer.from([f]), applyFilter(f, row, rows[i - 1], opts.bpp || 1)]));
  });
  parts.push(chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function applyFilter(type, row, prev, bpp) {
  if (type === 0) return Buffer.from(row);
  var out = Buffer.alloc(row.length);
  for (var x = 0; x < row.length; x++) {
    var a = x >= bpp ? row[x - bpp] : 0;
    var b = prev ? prev[x] : 0;
    var c = (x >= bpp && prev) ? prev[x - bpp] : 0;
    var v;
    if (type === 1) v = row[x] - a;
    else if (type === 2) v = row[x] - b;
    else if (type === 3) v = row[x] - ((a + b) >> 1);
    else if (type === 4) v = row[x] - paeth(a, b, c);
    out[x] = v & 0xff;
  }
  return out;
}

function paeth(a, b, c) {
  var p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ------------------------------------------------------------------ tests */

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '' : '\n          got ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function px(img, i) {
  return [img.pixels[i * 4], img.pixels[i * 4 + 1], img.pixels[i * 4 + 2], img.pixels[i * 4 + 3]];
}

// 1. truecolor 8-bit, filter None — the well-trodden path
var rgb = build(2, 1, 8, 2, [Buffer.from([255, 0, 0, 0, 255, 0])], { bpp: 3 });
check('colorType 2 (RGB8)', [px(png.decode(rgb), 0), px(png.decode(rgb), 1)],
  [[255, 0, 0, 255], [0, 255, 0, 255]]);

// 2. RGBA 8-bit
var rgba = build(1, 1, 8, 6, [Buffer.from([10, 20, 30, 128])], { bpp: 4 });
check('colorType 6 (RGBA8)', px(png.decode(rgba), 0), [10, 20, 30, 128]);

// 3. grayscale 8-bit
var g8 = build(2, 1, 8, 0, [Buffer.from([0, 200])], { bpp: 1 });
check('colorType 0 (gray8)', [px(png.decode(g8), 0), px(png.decode(g8), 1)],
  [[0, 0, 0, 255], [200, 200, 200, 255]]);

// 4. grayscale + alpha 8-bit
var ga = build(1, 1, 8, 4, [Buffer.from([90, 64])], { bpp: 2 });
check('colorType 4 (gray+alpha)', px(png.decode(ga), 0), [90, 90, 90, 64]);

// 5. palette + tRNS
var plte = Buffer.from([255, 0, 0, 0, 0, 255]);
var pal = build(2, 1, 8, 3, [Buffer.from([0, 1])], { bpp: 1, plte: plte, trns: Buffer.from([255, 17]) });
var palImg = png.decode(pal);
check('colorType 3 (palette + tRNS)', [px(palImg, 0), px(palImg, 1)],
  [[255, 0, 0, 255], [0, 0, 255, 17]]);

// 6. 16-bit truecolor — high byte should survive
var rgb16 = build(1, 1, 16, 2, [Buffer.from([0xAB, 0xCD, 0x12, 0x34, 0x56, 0x78])], { bpp: 6 });
check('colorType 2 @ 16-bit', px(png.decode(rgb16), 0), [0xAB, 0x12, 0x56, 255]);

// 7. every filter type, multi-row, must reconstruct exactly
var rows = [];
for (var y = 0; y < 5; y++) {
  var r = Buffer.alloc(9);
  for (var x = 0; x < 9; x++) r[x] = (y * 40 + x * 7) & 0xff;
  rows.push(r);
}
var filtered = build(3, 5, 8, 2, rows, { bpp: 3, filters: [0, 1, 2, 3, 4] });
var fimg = png.decode(filtered);
var roundTripped = true;
for (var y2 = 0; y2 < 5; y2++) {
  for (var x2 = 0; x2 < 3; x2++) {
    var i = y2 * 3 + x2;
    for (var ch = 0; ch < 3; ch++) {
      if (fimg.pixels[i * 4 + ch] !== rows[y2][x2 * 3 + ch]) roundTripped = false;
    }
  }
}
check('all 5 filter types round-trip', roundTripped, true);

// 8. interlaced must be REJECTED, not silently mis-decoded
var inter = build(1, 1, 8, 2, [Buffer.from([1, 2, 3])], { bpp: 3, interlace: 1 });
var threw = false;
try { png.decode(inter); } catch (e) { threw = /interlac/i.test(e.message); }
check('interlaced rejected (not mis-decoded)', threw, true);

// 9. malformed input must not crash readFile
var fs = require('fs');
var tmp = require('path').join(require('os').tmpdir(), 'brandkit-png-test.png');
fs.writeFileSync(tmp, Buffer.from('not a png at all'));
check('readFile returns null on junk', png.readFile(tmp), null);

// 10a. missing IEND but complete image data — lenient decode is correct
fs.writeFileSync(tmp, rgb.slice(0, rgb.length - 12));
check('decodes despite missing IEND', px(png.readFile(tmp), 0), [255, 0, 0, 255]);

// 10b. genuinely corrupt deflate stream must fail closed, not crash
fs.writeFileSync(tmp, rgb.slice(0, rgb.length - 30));
check('readFile null on corrupt IDAT', png.readFile(tmp), null);

// 10c. a chunk length that overruns the buffer must not crash
var evil = Buffer.from(rgb);
evil.writeUInt32BE(0x7ffffff0, 8); // IHDR length claims ~2GB
fs.writeFileSync(tmp, evil);
check('readFile null on overlong chunk length', png.readFile(tmp), null);

// 10d. absurd dimensions must be refused before allocating
var huge = build(1, 1, 8, 2, [Buffer.from([1, 2, 3])], { bpp: 3 });
huge.writeUInt32BE(60000, 16); huge.writeUInt32BE(60000, 20); // 3.6e9 px
fs.writeFileSync(tmp, huge);
check('readFile null on oversized image', png.readFile(tmp), null);

// 11. presence() on a known image
var solid = build(4, 4, 8, 2, Array.from({ length: 4 }, function () {
  return Buffer.from([0xEF, 0x46, 0x3B, 0xEF, 0x46, 0x3B, 0, 0, 0, 0, 0, 0]);
}), { bpp: 3 });
var simg = png.decode(solid);
check('presence() finds exact color', png.presence(simg, '#EF463B').share, 0.5);
check('presence() rejects absent color', png.presence(simg, '#0284C7').hits, 0);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
