/**
 * Ingest a directory of brand material.
 *
 * Handles both a website-import archive (screenshots/, assets/, a tokens JSON)
 * and a loose folder someone dropped files into. Nothing here trusts a label:
 * declared values are read, painted pixels are measured, and the two are
 * reported separately so `reconcile` can prefer evidence over assertion.
 */
var fs = require('fs');
var path = require('path');
var png = require('./png');
var extractCSS = require('../extract-css');
var extractLogos = require('../extract-logos');

var SKIP_DIRS = { node_modules: 1, '.git': 1, dist: 1, build: 1, '.next': 1 };

function ingest(dir, opts) {
  opts = opts || {};
  var out = {
    kind: 'dir',
    source: dir,
    surfaces: [],       // measured: dominant colors per screenshot
    cssVars: null,      // declared: :root custom properties
    fontsDeclared: [],  // declared: font-family / @font-face / Google Fonts
    logos: [],          // real asset files
    claims: null,       // a tokens JSON found in the dir — assertions, not evidence
    screenshots: 0,
    notes: []
  };

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    out.notes.push('not a directory: ' + dir);
    return out;
  }

  var files = walk(dir, 0, []);

  // ---- Measured: pixels -----------------------------------------------
  var shots = files.filter(function (f) {
    return /\.png$/i.test(f) && !/logo|icon|favicon|mark|wordmark/i.test(path.basename(f));
  });
  // Prefer a directory literally named screenshots/ when one exists.
  var named = shots.filter(function (f) { return /(^|[\/\\])screenshots?[\/\\]/i.test(f); });
  if (named.length) shots = named;

  // Paths (not decoded images) — a later claim audit re-reads these one at a
  // time, since a full-page screenshot costs ~40MB decoded.
  out._imageFiles = [];

  shots.slice(0, opts.maxScreenshots || 40).forEach(function (f) {
    var img = png.readFile(f);
    if (!img) { out.notes.push('could not decode ' + path.basename(f)); return; }
    out.screenshots++;
    out._imageFiles.push(f);
    out.surfaces.push({
      file: path.relative(dir, f),
      width: img.width,
      height: img.height,
      // Deep enough that an accent — which paints far less area than a
      // surface — still surfaces in the per-page list.
      colors: png.dominantColors(img, { top: 14 })
    });
  });

  // ---- Declared: stylesheets ------------------------------------------
  out.cssVars = extractCSS.extract(dir);

  var cssFiles = files.filter(function (f) { return /\.(css|scss)$/i.test(f); });
  var htmlFiles = files.filter(function (f) { return /\.html?$/i.test(f); });
  cssFiles.concat(htmlFiles).slice(0, 60).forEach(function (f) {
    var text = read(f);
    if (text) collectFonts(text, out.fontsDeclared);
  });

  // ---- Logo candidates -------------------------------------------------
  // Keyword matching alone misses real marks: GrayMeta's is
  // `graymeta-horz_color.png`, which contains no "logo"/"brand"/"mark". So
  // every image is a candidate here and `reconcile` ranks them, where the
  // brand name is known.
  out.logos = extractLogos.extract(dir) || [];
  out.imageCandidates = files
    .filter(function (f) { return /\.(svg|png|jpe?g|webp)$/i.test(f); })
    .filter(function (f) { return !/(^|[\/\\])screenshots?[\/\\]/i.test(f); })
    .map(function (f) { return { file: f, rel: path.relative(dir, f), base: path.basename(f) }; });

  // ---- Claims: a tokens JSON someone else produced ---------------------
  var claimFile = files.filter(function (f) {
    return /(branding|brand-tokens|tokens|design-tokens)\.json$/i.test(path.basename(f));
  })[0];
  if (claimFile) {
    try {
      out.claims = { file: path.relative(dir, claimFile), data: JSON.parse(read(claimFile)) };
    } catch (_) {
      out.notes.push('could not parse ' + path.basename(claimFile));
    }
  }

  return out;
}

function walk(dir, depth, acc) {
  if (depth > 6) return acc;
  var entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return acc; }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    var full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS[e.name] && e.name[0] !== '.') walk(full, depth + 1, acc);
    } else if (e.isFile()) {
      acc.push(full);
    }
  }
  return acc;
}

function read(file) {
  try {
    if (fs.statSync(file).size > 4e6) return null; // don't slurp huge files
    return fs.readFileSync(file, 'utf8');
  } catch (_) { return null; }
}

/**
 * Pull font families out of CSS/HTML text.
 *
 * Records `declared` (a font-family the page asks for) separately from
 * `faceOnly` (an @font-face or Google Fonts link with no matching
 * font-family rule). That distinction is the whole game: a font can be
 * downloaded and never painted, and treating the two as equivalent is how a
 * brand ends up documenting a typeface it does not use.
 */
function collectFonts(text, acc) {
  var seen = {};
  acc.forEach(function (f) { seen[f.family.toLowerCase()] = f; });

  function add(family, how) {
    var name = String(family).replace(/["']/g, '').trim();
    if (!name || /^(inherit|initial|unset|var\(|sans-serif|serif|monospace|system-ui)/i.test(name)) return;
    var key = name.toLowerCase();
    if (!seen[key]) { seen[key] = { family: name, declared: 0, faceOnly: 0 }; acc.push(seen[key]); }
    seen[key][how]++;
  }

  var m;
  var famRe = /font-family\s*:\s*([^;}{]+)/gi;
  while ((m = famRe.exec(text)) !== null) add(m[1].split(',')[0], 'declared');

  var faceRe = /@font-face\s*\{[^}]*?font-family\s*:\s*([^;}]+)/gi;
  while ((m = faceRe.exec(text)) !== null) add(m[1].split(',')[0], 'faceOnly');

  var gfRe = /fonts\.googleapis\.com\/css2?\?([^"'\s>]+)/gi;
  while ((m = gfRe.exec(text)) !== null) {
    var famParams = m[1].match(/family=([^&]+)/g) || [];
    famParams.forEach(function (p) {
      add(decodeURIComponent(p.slice(7)).split(':')[0].replace(/\+/g, ' '), 'faceOnly');
    });
  }
}

module.exports = { ingest: ingest, collectFonts: collectFonts };
