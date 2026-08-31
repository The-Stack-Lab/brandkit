var fs = require('fs');
var path = require('path');
var resolve = require('../lib/resolve');
var template = require('../lib/template');

/**
 * Locate unfilled markers. Mirrors findTodos() in cli/generate.js — build must
 * not require generate, so the walk is duplicated rather than shared.
 */
function findTodos(obj, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  if (typeof obj === 'string') {
    if (obj.trim().indexOf('__TODO') === 0) out.push(prefix);
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach(function (v, i) { findTodos(v, prefix + '[' + i + ']', out); });
    return out;
  }
  Object.keys(obj).forEach(function (k) {
    findTodos(obj[k], prefix ? prefix + '.' + k : k, out);
  });
  return out;
}

// Sections whose gaps make a guide unfit to put in front of a client.
var BLOCKING_SECTIONS = ['brand', 'voice', 'logos', 'colors', 'fonts'];

module.exports = function build(args) {
  var force = args.indexOf('--force') !== -1;
  args = args.filter(function (a) { return a !== '--force'; });
  var targetDir = path.resolve(args[0] || '.');
  var distDir = resolve.getDistPath();

  var configPath = path.join(targetDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('');
    console.error('  No config.json found in ' + targetDir);
    console.error('  Run: brandkit init ' + path.relative(process.cwd(), targetDir));
    console.error('');
    process.exit(1);
  }

  console.log('');
  console.log('  brandkit build');
  console.log('');
  console.log('  Reading ' + path.relative(process.cwd(), configPath) + '...');

  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  // A guide with unfilled essentials is not ready to send. Building it anyway
  // is how brandkit's own placeholder content reached client approval
  // documents — so say so plainly, and make shipping it a deliberate act.
  var blocking = findTodos(config).filter(function (p) {
    return BLOCKING_SECTIONS.indexOf(p.split(/[.[]/)[0]) !== -1;
  });

  // Emptiness counts too. `generate` clears a section that only ever held
  // brandkit's scaffold — `logos: []`, `voice.do: []` — and those carry no
  // marker, so a marker-only gate waved through a guide with no logos and no
  // voice at all. Both are in BLOCKING_SECTIONS precisely because a client
  // should not be shown a guide missing them.
  function isBlank(v) {
    if (v === undefined || v === null) return true;
    if (typeof v === 'string') return v.trim() === '' || v.trim().indexOf('__TODO') === 0;
    if (Array.isArray(v)) return v.length === 0;
    if (typeof v === 'object') {
      var keys = Object.keys(v);
      if (!keys.length) return true;
      return keys.every(function (k) { return isBlank(v[k]); });
    }
    return false;
  }
  BLOCKING_SECTIONS.forEach(function (section) {
    if (isBlank(config[section])) blocking.push(section + ' (empty)');
  });
  if (blocking.length && !force) {
    console.error('  ' + blocking.length + ' essential field(s) are still undefined:');
    blocking.slice(0, 8).forEach(function (p) { console.error('      ' + p); });
    if (blocking.length > 8) console.error('      … and ' + (blocking.length - 8) + ' more');
    console.error('');
    console.error('  Fill them in, or run `brandkit build --force` to build a draft anyway.');
    console.error('');
    process.exitCode = 1;
    return;
  }
  if (blocking.length) {
    console.log('  Building with ' + blocking.length + ' essential field(s) still undefined (--force).');
    console.log('');
  }

  var exported = template.build(distDir, targetDir, config);

  var brandName = (config.brand && config.brand.displayName) || 'Brand';
  console.log('    built   index.html   (' + brandName + ' title + fonts + embedded brand data)');
  console.log('    built   styles.css   (:root variables generated)');
  console.log('    built   changelog.html (' + brandName + ' title + fonts)');
  console.log('    copied  engine.js, changelog.js');
  if (exported && exported.written) {
    exported.written.forEach(function (f) {
      console.log('    wrote   ' + f + '   (agent-native export)');
    });
  }
  console.log('');
  console.log('  Ready to deploy. Serve ' + path.relative(process.cwd(), targetDir) + '/ as static files.');
  console.log('');
};
