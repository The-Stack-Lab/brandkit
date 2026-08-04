/**
 * Regression tests for defects found in adversarial review of lib/ingest.
 * Each case names the failure it locks out.
 */
var zlib = require('zlib');
var os = require('os');
var path = require('path');
var fs = require('fs');
var png = require('../lib/ingest/png');
var sourceDir = require('../lib/ingest/source-dir');
var reconciler = require('../lib/ingest/reconcile');
var ingest = require('../lib/ingest');
var helpers = require('../lib/generate-helpers');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

function chunk(type, data) {
  var len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
}

/** Build an RGB PNG from a (x,y)->[r,g,b] function. */
function makePng(w, h, at) {
  var ih = Buffer.alloc(13);
  ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  var rows = [];
  for (var y = 0; y < h; y++) {
    var row = Buffer.alloc(w * 3 + 1);
    for (var x = 0; x < w; x++) {
      var c = at(x, y), o = 1 + x * 3;
      row[o] = c[0]; row[o + 1] = c[1]; row[o + 2] = c[2];
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

var tmp = os.tmpdir();

/* -- sampling must not alias whole colors away ------------------------- */
// Width 1200 with a stride that divides it sampled 100 of 1200 columns, so a
// narrow vertical element read as absent from the page.
var BLUE = [0x1F, 0x6F, 0xEB], RED = [0xE0, 0x10, 0x10], WHITE = [255, 255, 255];
var bars = png.decode(makePng(1200, 400, function (x) {
  if (x >= 1 && x < 7) return BLUE;
  if (x >= 600 && x < 606) return RED;
  return WHITE;
}));
check('narrow left-edge bar is found', png.presence(bars, '#1F6FEB').hits > 0, true);
check('both bars report equal share',
  Math.abs(png.presence(bars, '#1F6FEB').share - png.presence(bars, '#E01010').share) < 0.0005, true);

/* -- hex parsing -------------------------------------------------------- */
// #RRGGBBAA is valid CSS; parsing it whole shifted every channel by one and
// turned opaque red into blue.
function themeFrom(vars) {
  var src = {
    kind: 'dir', source: 't', surfaces: [], cssVars: vars, fontsDeclared: [],
    logos: [], imageCandidates: [], claims: null, notes: [], _imageFiles: []
  };
  return ingest.toConfigFields(reconciler.reconcile([src], {}), {});
}
check('8-digit hex keeps its channels', themeFrom({ '--accent': '#FF0000FF' }).theme['--accent-rgb'], '255, 0, 0');
check('4-digit hex keeps its channels', themeFrom({ '--accent': '#F00F' }).theme['--accent-rgb'], '255, 0, 0');
check('3-digit hex expands', themeFrom({ '--accent': '#F00' }).theme['--accent-rgb'], '255, 0, 0');
var at = themeFrom({ '--accent': '#FF0000FF' }).theme['--accent-text'];
check('accent-text meets 4.5:1 on white', parseFloat(helpers.contrastRatio(at, '#FFFFFF')) >= 4.5, true);
check('5-digit hex is refused', themeFrom({ '--accent': '#FF000' }).theme, null);

/* -- fonts: loaded is not rendered -------------------------------------- */
var fonts = [];
sourceDir.collectFonts(
  '@font-face{font-family:"NeverUsed";src:url(a.woff2)} body{font-family:Inter !important} h1{font-family:Inter}',
  fonts);
check('@font-face counts as faceOnly, not declared',
  fonts.filter(function (f) { return f.family === 'NeverUsed'; })[0], { family: 'NeverUsed', declared: 0, faceOnly: 1 });
check('!important is stripped from the family',
  fonts.filter(function (f) { return f.family === 'Inter'; })[0], { family: 'Inter', declared: 2, faceOnly: 0 });

// A never-rendered font must not inherit the body font's evidence string.
var fsrc = {
  kind: 'render', source: 'x', surfaces: [], cssVars: null, _imageFiles: [],
  fontsRendered: [{ family: 'Inter', count: 9 }],
  fontsDeclared: [{ family: 'Lobster', declared: 0, faceOnly: 1 }],
  logos: [], imageCandidates: [], claims: null, notes: [], pages: []
};
var fres = reconciler.reconcile([fsrc], {});
check('never-rendered font is not promoted to display', fres.tokens.fonts.display, 'Inter');
check('never-rendered font is rejected',
  fres.rejected.some(function (r) { return r.value === 'Lobster'; }), true);

// With no render data at all, each font must carry evidence describing itself
// rather than inheriting the body font's rule count.
var dsrc = {
  kind: 'dir', source: 'x', surfaces: [], cssVars: null, _imageFiles: [],
  fontsDeclared: [
    { family: 'Inter', declared: 9, faceOnly: 0 },
    { family: 'Lobster', declared: 2, faceOnly: 0 }
  ],
  logos: [], imageCandidates: [], claims: null, notes: []
};
var dres = reconciler.reconcile([dsrc], {});
check('display evidence cites its own rule count',
  /2 rule\(s\)/.test((dres.evidence['fonts.display'] || {}).detail || ''), true);
check('body evidence cites its own rule count',
  /9 rule\(s\)/.test((dres.evidence['fonts.body'] || {}).detail || ''), true);

/* -- malformed input must not abort the run ----------------------------- */
var threw = false;
try { sourceDir.collectFonts('<link href="https://fonts.googleapis.com/css2?family=Foo%zz">', []); }
catch (_) { threw = true; }
check('malformed percent-escape does not throw', threw, false);
check('unreadable directory returns a usable shape',
  sourceDir.ingest(path.join(tmp, 'brandkit-nope-zzz')).imageCandidates, []);

/* -- source classification ---------------------------------------------- */
check('mistyped file path is not a URL', ingest.classify('screenshot.png'), 'missing');
check('bare hostname is a URL', ingest.classify('example.com'), 'url');
check('non-http scheme is named', ingest.classify('file:///etc/passwd'), 'unsupported-scheme');

/* -- accent must be used, not merely vivid ------------------------------ */
// A vivid pixel run in one hero photo outranked the real brand color.
var photo = path.join(tmp, 'brandkit-test-photo.png');
fs.writeFileSync(photo, makePng(400, 400, function (x, y) {
  if (y === 0 && x < 4) return [0xFF, 0x6A, 0x00];   // trace sunset pixels
  if (x < 48) return [0x1F, 0x6F, 0xEB];             // the actual brand blue
  return WHITE;
}));
var pimg = png.readFile(photo);
var psrc = {
  kind: 'dir', source: 'p', cssVars: null, fontsDeclared: [], logos: [],
  imageCandidates: [], claims: null, notes: [], _imageFiles: [photo],
  surfaces: [{ file: 'p.png', colors: png.dominantColors(pimg, { top: 14 }) }]
};
var pres = reconciler.reconcile([psrc], {});
check('accent is the used color, not the most vivid', pres.tokens.colors.primary, '#1F6FEB');

/* -- truncated image data must fail closed ------------------------------ */
var good = makePng(8, 8, function () { return [1, 2, 3]; });
var cut = path.join(tmp, 'brandkit-test-cut.png');
fs.writeFileSync(cut, good.slice(0, good.length - 24));
check('truncated IDAT decodes to null, not black', png.readFile(cut), null);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
