/**
 * basePath: every ref to a file brandkit generates must be absolute.
 *
 * A guide served at /brand (no trailing slash, e.g. behind a Next.js rewrite)
 * resolves a relative "changelog.html" to /changelog.html. build prefixed the
 * stylesheet, the scripts and brand.json, but not the two links between the
 * guide and its changelog. The test is generic on purpose: it fails for any
 * relative ref to a generated file, including ones added later.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var template = require('../lib/template');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

var distDir = path.join(__dirname, '..', 'dist');
var GENERATED = ['index.html', 'changelog.html', 'styles.css', 'engine.js', 'changelog.js',
  'brand.json', 'tokens.json', 'brand.md', 'config.json'];

function buildWith(basePath) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-basepath-'));
  var config = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'freeway.config.json'), 'utf8'));
  if (basePath === undefined) delete config.basePath; else config.basePath = basePath;
  config.changelog = [{ version: '1.0', date: 'June 2026', changes: ['Brand locked.'] }];
  template.build(distDir, dir, config);
  return dir;
}

// Every href/src in the built page that names a generated file.
function refsToGenerated(html) {
  // Case-insensitive, quoted or not: `<a HREF=brand.json>` is valid HTML too.
  var out = [], re = /\s(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi, m;
  while ((m = re.exec(html))) {
    var ref = m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]);
    var file = ref.split(/[?#]/)[0].split('/').pop();
    if (GENERATED.indexOf(file) !== -1) out.push(ref);
  }
  return out;
}

var based = buildWith('/brand');
['index.html', 'changelog.html'].forEach(function (page) {
  var refs = refsToGenerated(fs.readFileSync(path.join(based, page), 'utf8'));
  check(page + ': refs to generated files were found', refs.length > 0, true);
  check(page + ': none of them is relative',
    refs.filter(function (r) { return r.indexOf('/brand/') !== 0; }), []);
});
var basedIndex = fs.readFileSync(path.join(based, 'index.html'), 'utf8');
var basedLog = fs.readFileSync(path.join(based, 'changelog.html'), 'utf8');
check('the sidebar changelog link is prefixed', /id="sidebar-changelog" href="\/brand\/changelog\.html"/.test(basedIndex), true);
check('the back link is prefixed', /class="changelog-back" href="\/brand\/index\.html"/.test(basedLog), true);

// A trailing slash in the config must not double up.
var slashed = fs.readFileSync(path.join(buildWith('/brand/'), 'index.html'), 'utf8');
check('a trailing slash in basePath does not produce //', /\/brand\/\/|href="\/\/changelog/.test(slashed), false);

// basePath is author-controlled: it must not break out of the attribute.
// The breakout is an unescaped quote closing href=" early, so that is what is
// asserted, on both pages: the payload's quote must arrive as an entity.
var hostileDir = buildWith('/b"><script>alert(1)</script>');
['index.html', 'changelog.html'].forEach(function (page) {
  var html = fs.readFileSync(path.join(hostileDir, page), 'utf8');
  check(page + ': a hostile basePath cannot close the attribute', /href="\/b"/.test(html), false);
  check(page + ': and its quote is escaped where it lands', /href="\/b&quot;/.test(html), true);
});

// A lookalike attribute earlier in the page must not absorb the rewrite.
var decoyDist = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-decoy-dist-'));
fs.readdirSync(distDir).forEach(function (f) {
  var src = path.join(distDir, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(decoyDist, f));
});
fs.writeFileSync(path.join(decoyDist, 'index.html'),
  fs.readFileSync(path.join(distDir, 'index.html'), 'utf8').replace('<body>', '<body><div data-href="changelog.html"></div>'));
var decoyOut = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-decoy-out-'));
var decoyCfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'freeway.config.json'), 'utf8'));
decoyCfg.basePath = '/brand';
template.build(decoyDist, decoyOut, decoyCfg);
var decoyHtml = fs.readFileSync(path.join(decoyOut, 'index.html'), 'utf8');
check('a data-href lookalike does not absorb the rewrite',
  [/data-href="changelog\.html"/.test(decoyHtml), /id="sidebar-changelog" href="\/brand\/changelog\.html"/.test(decoyHtml)], [true, true]);

// No basePath: page-relative output, exactly as before.
var plain = buildWith(undefined);
check('without basePath the sidebar link stays relative',
  /id="sidebar-changelog" href="changelog\.html"/.test(fs.readFileSync(path.join(plain, 'index.html'), 'utf8')), true);
check('without basePath the back link stays relative',
  /class="changelog-back" href="index\.html"/.test(fs.readFileSync(path.join(plain, 'changelog.html'), 'utf8')), true);

// The runtime must agree with the build: engine.js sets the same href.
var engine = fs.readFileSync(path.join(distDir, 'engine.js'), 'utf8');
check('engine.js resolves the changelog link against BASE', /BASE\s*\+\s*['"]\/changelog\.html['"]/.test(engine), true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
