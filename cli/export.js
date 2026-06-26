var fs = require('fs');
var path = require('path');
var exporter = require('../lib/export');

/**
 * brandkit export [dir] [--format json|dtcg|md|all] [--out <dir>]
 *
 * Emit agent-native views of a brand from its config.json:
 *   brand.json   — normalized, semantic brand (roles, usage, contrast, assets)
 *   tokens.json  — W3C Design Tokens (DTCG) format
 *   brand.md     — an LLM brief ("how to be on-brand"), a.k.a. llms.txt
 */
module.exports = function exportCmd(args) {
  args = args || [];
  var positional = [];
  var format = 'all';
  var outDir = null;

  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--format' && args[i + 1]) { format = args[++i]; }
    else if (a.indexOf('--format=') === 0) { format = a.slice('--format='.length); }
    else if (a === '--out' && args[i + 1]) { outDir = args[++i]; }
    else if (a.indexOf('--out=') === 0) { outDir = a.slice('--out='.length); }
    else if (a.charAt(0) !== '-') { positional.push(a); }
  }

  var targetDir = path.resolve(positional[0] || '.');
  var configPath = path.join(targetDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('');
    console.error('  No config.json found in ' + targetDir);
    console.error('  Run: brandkit init ' + path.relative(process.cwd(), targetDir));
    console.error('');
    process.exit(1);
  }

  var config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('');
    console.error('  Could not parse ' + path.relative(process.cwd(), configPath) + ': ' + e.message);
    console.error('');
    process.exit(1);
  }

  var dest = outDir ? path.resolve(outDir) : targetDir;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });

  var result = exporter.writeExports(config, dest, format.split(','));

  console.log('');
  console.log('  brandkit export');
  console.log('');
  if (!result.written.length) {
    console.log('  Nothing written — unknown --format "' + format + '" (use json|dtcg|md|all).');
  } else {
    result.written.forEach(function (f) {
      console.log('    wrote   ' + path.join(path.relative(process.cwd(), dest) || '.', f));
    });
  }
  console.log('');
};
