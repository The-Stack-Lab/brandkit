/**
 * Tests for LAB-1433: config.schema.json is enforced, not just editor help.
 *
 * The schema was never checked against a real config before it was enforced.
 * Run against the 59 configs on the maintainer's machine, it rejected guides
 * that render correctly today: bare-array color groups (Freeway), free-text
 * contrast ratings, rgba neutrals. Those cases are pinned here so the schema
 * cannot drift back to breaking builds, and the configs brandkit itself writes
 * (the starter, generate's output) must validate clean so it cannot drift away
 * from the code either.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var spawnSync = require('child_process').spawnSync;
var validate = require('../lib/validate');
var schema = require('../lib/config-schema');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function read(rel) { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')); }
function errorsOf(cfg) { return validate.validateConfig(cfg).errors; }
function warningsOf(cfg) { return validate.validateConfig(cfg).warnings; }

/* ---------------- 1. The validator covers the schema ---------------- */

var raw = read('config.schema.json');
check('the schema uses no keyword the validator ignores', validate.unsupportedKeywords(raw), []);

/* ---------------- 2. What brandkit writes is valid ---------------- */

var starter = schema.starterConfig();
check('starterConfig() has no errors', errorsOf(starter), []);
check('starterConfig() has no warnings', warningsOf(starter), []);
check('example/config.json has no errors', errorsOf(read('example/config.json')), []);
check('example/config.json has no warnings', warningsOf(read('example/config.json')), []);
check('the 1.6.0 starter has no errors', errorsOf(read('test/fixtures/starter-1.6.0.json')), []);

// generate's output, from a host project with a theme to extract.
var host = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-schema-'));
fs.writeFileSync(path.join(host, 'package.json'), JSON.stringify({ name: 'acme-site' }));
fs.mkdirSync(path.join(host, 'src'));
fs.writeFileSync(path.join(host, 'src', 'app.css'),
  ':root {\n  --primary: #0B6E4F;\n  --background: #FFFFFF;\n  --foreground: #111111;\n  --font-display: "Fraunces", serif;\n}\n');
var gen = spawnSync(process.execPath, [path.join(__dirname, '..', 'bin', 'brandkit.js'), 'generate', 'brand'],
  { cwd: host, encoding: 'utf8' });
check('generate ran', gen.status, 0);
var generated = JSON.parse(fs.readFileSync(path.join(host, 'brand', 'config.json'), 'utf8'));
check('generate output has no errors', errorsOf(generated), []);
check('generate output has no warnings', warningsOf(generated), []);
fs.rmSync(host, { recursive: true, force: true });

/* ---------------- 3. Shapes shipped guides use are not errors ---------------- */

var freeway = read('test/fixtures/freeway.config.json');
check('Freeway (bare-array color groups) has no errors', errorsOf(freeway), []);

var free = clone(starter);
free.accessibility[0].rating = 'Fail: never use';
check('a free-text rating is a warning, not an error', errorsOf(free), []);
check('and the warning names the field', warningsOf(free).length === 1 && warningsOf(free)[0].indexOf('accessibility[0].rating') === 0, true);

var rgba = clone(starter);
rgba.colors.neutrals.items[0].hex = 'rgba(255, 255, 255, 0.64)';
check('an rgba neutral is a warning, not an error', errorsOf(rgba), []);

var todo = clone(starter);
todo.accessibility[0].rating = '__TODO';
todo.brand.tagline = '__TODO';
todo.logoSizes = '__TODO';
check('__TODO reads as unset, not malformed', validate.validateConfig(todo), { valid: true, errors: [], warnings: [] });

var extra = clone(starter);
extra.colours = {};
extra.typography[0].sizeMobile = '28px';
check('unknown keys are warnings', errorsOf(extra), []);
check('each unknown key is named', warningsOf(extra).sort(), ['colours: unknown key', 'typography[0].sizeMobile: unknown key']);

/* ---------------- 4. The wrong shape is an error ---------------- */

var stops = clone(starter);
stops.gradients[0].stops = ['#FF6900', '#E65C00'];
check('a bare-string gradient stop is an error (it renders as an empty dot)', errorsOf(stops), [
  'gradients[0].stops[0]: expected object, got string "#FF6900"',
  'gradients[0].stops[1]: expected object, got string "#E65C00"'
]);

var noFonts = clone(starter);
delete noFonts.fonts;
check('a missing required section is an error', errorsOf(noFonts), ['fonts: required']);

var wrongType = clone(starter);
wrongType.brand = 'Acme';
check('a wrong top-level type is an error', errorsOf(wrongType), ['brand: expected object, got string "Acme"']);

var badFormat = clone(starter);
badFormat.formats = [{ name: 'Poster', width: '1080' }];
check('a wrong type inside a oneOf names the closest shape', errorsOf(badFormat), ['formats[0].width: expected number, got string "1080"']);

/* ---------------- 5. build and export stop on errors ---------------- */

var bin = path.join(__dirname, '..', 'bin', 'brandkit.js');
var guide = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-schema-guide-'));
fs.writeFileSync(path.join(guide, 'config.json'), JSON.stringify(stops));

var exp = spawnSync(process.execPath, [bin, 'export', guide], { encoding: 'utf8' });
check('export refuses an invalid config', exp.status, 1);
check('and says which field', exp.stderr.indexOf('gradients[0].stops[0]') !== -1, true);
check('and writes nothing', fs.existsSync(path.join(guide, 'brand.json')), false);
var expForced = spawnSync(process.execPath, [bin, 'export', guide, '--force'], { encoding: 'utf8' });
check('export --force writes anyway', expForced.status === 0 && fs.existsSync(path.join(guide, 'brand.json')), true);

var bld = spawnSync(process.execPath, [bin, 'build', guide], { encoding: 'utf8' });
check('build refuses an invalid config', bld.status, 1);
check('and points at --force', bld.stderr.indexOf('brandkit build --force') !== -1, true);

fs.writeFileSync(path.join(guide, 'config.json'), JSON.stringify(extra));
var warned = spawnSync(process.execPath, [bin, 'export', guide], { encoding: 'utf8' });
check('warnings alone do not stop export', warned.status, 0);
check('but are printed', warned.stdout.indexOf('colours: unknown key') !== -1, true);
fs.rmSync(guide, { recursive: true, force: true });

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
