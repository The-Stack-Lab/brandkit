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
  var out = [], re = /\b(?:href|src)\s*=\s*["']([^"']+)["']/g, m;
  while ((m = re.exec(html))) {
    var file = m[1].split(/[?#]/)[0].split('/').pop();
    if (GENERATED.indexOf(file) !== -1) out.push(m[1]);
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
var hostile = fs.readFileSync(path.join(buildWith('/b"><script>alert(1)</script>'), 'changelog.html'), 'utf8');
check('a hostile basePath cannot break out of the new attributes', /<script>alert\(1\)<\/script>/.test(hostile), false);

// No basePath: page-relative output, exactly as before.
var plain = buildWith(undefined);
check('without basePath the sidebar link stays relative',
  /id="sidebar-changelog" href="changelog\.html"/.test(fs.readFileSync(path.join(plain, 'index.html'), 'utf8')), true);
check('without basePath the back link stays relative',
  /class="changelog-back" href="index\.html"/.test(fs.readFileSync(path.join(plain, 'changelog.html'), 'utf8')), true);

// The runtime must agree with the build: engine.js sets the same href.
var engine = fs.readFileSync(path.join(distDir, 'engine.js'), 'utf8');
check('engine.js resolves the changelog link against BASE', engine.indexOf("BASE + '/changelog.html'") !== -1, true);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
