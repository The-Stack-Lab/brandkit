var fs = require('fs');
var path = require('path');
var resolve = require('../lib/resolve');
var template = require('../lib/template');
var unfilled = require('../lib/unfilled');

module.exports = function build(args) {
  // `--` ends the options: everything after it is positional, so a directory
  // whose name starts with a dash stays expressible (`-- ./-weird-dir`), and
  // a literal `--force` after it is a path, not the flag. Split first, then
  // read flags out of the left side only.
  var sep = args.indexOf('--');
  var opts = sep === -1 ? args : args.slice(0, sep);
  var rest = sep === -1 ? [] : args.slice(sep + 1);
  var force = opts.indexOf('--force') !== -1;
  // Anything else with a leading dash is a typo, not a directory name:
  // `build <dir> --froce` used to be accepted silently.
  var unknown = opts.filter(function (a) {
    return a.charAt(0) === '-' && a !== '--force';
  })[0];
  if (unknown) {
    console.error('');
    console.error('  Unknown option: ' + unknown);
    console.error('  Usage: brandkit build [dir] [--force]');
    console.error('');
    process.exit(1);
  }
  var positional = opts.filter(function (a) { return a.charAt(0) !== '-'; }).concat(rest);
  var targetDir = path.resolve(positional[0] || '.');
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
  // documents: so say so plainly, and make shipping it a deliberate act.
  var blocking = unfilled.findTodos(config).filter(unfilled.isBlocking);

  // Structural emptiness counts too: `generate` clears a section that only held
  // brandkit's scaffold, and that carries no marker. Reported per blocking
  // field, and only when no marker path already covers it, listing
  // `voice.description` and `voice (empty)` separately inflated the count.
  unfilled.BLOCKING_PATHS.forEach(function (fieldPath) {
    var already = blocking.some(function (p) {
      return p === fieldPath || p.indexOf(fieldPath + '.') === 0 || p.indexOf(fieldPath + '[') === 0;
    });
    if (already) return;
    var parts = fieldPath.split('.');
    var v = config;
    for (var i = 0; i < parts.length && v !== undefined && v !== null; i++) v = v[parts[i]];
    if (unfilled.isBlank(v)) blocking.push(fieldPath + ' (not yet defined)');
  });

  if (blocking.length && !force) {
    console.error('  ' + blocking.length + ' essential field(s) are not yet defined:');
    blocking.slice(0, 8).forEach(function (p) { console.error('      ' + p); });
    if (blocking.length > 8) console.error('      \u2026 and ' + (blocking.length - 8) + ' more');
    console.error('');
    console.error('  Fill them in, or run `brandkit build --force` to build a draft anyway.');
    console.error('');
    process.exitCode = 1;
    return;
  }
  if (blocking.length) {
    console.log('  Building with ' + blocking.length + ' essential field(s) not yet defined (--force).');
    console.log('');
  }

  // The chrome (sidebar, controls, toasts) is deliberately not brand-painted,
  // so a --bk-* key in the theme is a misunderstanding worth naming rather than
  // silently dropping. The build drops it either way; see lib/template.js.
  var chromeKeys = Object.keys(config.theme || {}).filter(template.isChromeToken);
  if (chromeKeys.length) {
    console.log('  Ignoring ' + chromeKeys.length + ' reserved chrome token(s) in theme: ' + chromeKeys.join(', '));
    console.log('    --bk-* styles the guide UI, not the brand. Remove them from config.theme.');
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
