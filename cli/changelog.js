var fs = require('fs');
var path = require('path');

/**
 * brandkit changelog — record a brand-guide revision.
 *
 * Prepends a `{ version, date, changes }` entry to config.changelog (newest
 * first) and bumps brand.version. A fresh guide starts at 0.1; each call
 * minor-bumps (0.1 → 0.2 → …); --lock jumps to 1.0 when the brand is finalized.
 *
 *   brandkit changelog "Added gradients" "Tuned contrast"
 *   brandkit changelog --lock "Brand locked"
 *   brandkit changelog --major "v2 redesign"
 *   brandkit changelog --version 0.5 "Set explicitly"
 *   brandkit changelog --dir example "Update the demo"
 */
module.exports = function changelog(args) {
  var opts = parseArgs(args);

  if (opts.help) {
    printUsage();
    return;
  }

  if (opts.error) {
    console.error('');
    console.error('  ' + opts.error);
    console.error('');
    printUsage();
    process.exit(1);
  }

  var targetDir = path.resolve(opts.dir || '.');
  var configPath = path.join(targetDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('');
    console.error('  No config.json found in ' + targetDir);
    console.error('  Run: brandkit init ' + path.relative(process.cwd(), targetDir));
    console.error('');
    process.exit(1);
  }

  // Drop blank/whitespace-only messages so a stray empty arg can't create a
  // blank bullet (and silently bump the version).
  opts.messages = opts.messages.filter(function (m) { return String(m).trim() !== ''; });
  if (!opts.messages.length) {
    console.error('');
    console.error('  Nothing to log — pass at least one change message.');
    console.error('  Example: brandkit changelog "Added the gradient system"');
    console.error('');
    process.exit(1);
  }

  // Reject a malformed explicit --version so junk never lands in brand.version
  // (which build/template.js consume downstream).
  if (opts.version && !/^\d+\.\d+(\.\d+)?$/.test(opts.version)) {
    console.error('');
    console.error('  Invalid --version "' + opts.version + '" — expected MAJOR.MINOR (e.g. 0.3 or 1.0).');
    console.error('');
    process.exit(1);
  }

  var config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.brand = config.brand || {};
  if (!Array.isArray(config.changelog)) config.changelog = [];

  var prevVersion = config.brand.version || '0.1';

  // --lock finalizes a pre-1.0 brand at 1.0; refuse to move a >=1.0 brand
  // backward (which would also break the newest-first version ordering).
  if (opts.lock && parseVersion(prevVersion).major >= 1) {
    console.error('');
    console.error('  Already at v' + prevVersion + ' — the brand is locked (>= 1.0).');
    console.error('  Use --major or --version X.Y to bump further.');
    console.error('');
    process.exit(1);
  }

  var nextVersion = nextVersionFor(prevVersion, opts);
  var date = opts.date || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  var entry = { version: nextVersion, date: date, changes: opts.messages.slice() };
  config.changelog.unshift(entry);
  config.brand.version = nextVersion;

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log('  brandkit changelog');
  console.log('');
  console.log('  v' + prevVersion + ' → v' + nextVersion + ' · ' + opts.messages.length +
    ' change' + (opts.messages.length === 1 ? '' : 's') + ' (' + date + ')');
  opts.messages.forEach(function (m) {
    console.log('    • ' + m);
  });
  console.log('');
  console.log('  Updated ' + path.relative(process.cwd(), configPath));
  console.log('  Run `brandkit build` (or `export`) to refresh the deployed page and agent exports.');
  console.log('');
};

/**
 * Decide the next version string from the previous one + flags.
 *  --version X.Y  → explicit
 *  --lock         → 1.0
 *  --major        → next whole major, minor reset to 0
 *  default        → minor + 1
 */
function nextVersionFor(prev, opts) {
  if (opts.version) return opts.version;
  if (opts.lock) return '1.0';

  var parsed = parseVersion(prev);
  if (opts.major) return (parsed.major + 1) + '.0';
  return parsed.major + '.' + (parsed.minor + 1);
}

// "0.3" → { major: 0, minor: 3 }; tolerant of junk → { 0, 1 }.
function parseVersion(v) {
  var m = String(v == null ? '' : v).match(/^(\d+)\.(\d+)/);
  if (!m) return { major: 0, minor: 1 };
  return { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
}

function parseArgs(args) {
  var opts = { messages: [], dir: '.', lock: false, major: false, version: null, date: null, help: false, error: null };
  var valueFlags = { '--version': 'version', '--date': 'date', '--dir': 'dir' };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--lock') opts.lock = true;
    else if (a === '--major') opts.major = true;
    else if (valueFlags[a]) {
      // A value flag at the end of argv would otherwise read undefined and be
      // silently ignored — error instead.
      if (i + 1 >= args.length) { opts.error = a + ' requires a value.'; break; }
      opts[valueFlags[a]] = args[++i];
    }
    // Reject an unknown --flag (e.g. a "--majro" typo) rather than recording it
    // as a changelog message. Single-dash args pass through so a message can
    // still start with "-" (e.g. "-20% load time").
    else if (a.indexOf('--') === 0) { opts.error = 'Unknown option: ' + a; break; }
    else opts.messages.push(a);
  }
  return opts;
}

function printUsage() {
  console.log('');
  console.log('  brandkit changelog — record a brand-guide revision');
  console.log('');
  console.log('  Usage:');
  console.log('    brandkit changelog "<message>" ["<message>" ...]');
  console.log('');
  console.log('  Options:');
  console.log('    --lock           Mark the brand as finalized (version → 1.0)');
  console.log('    --major          Bump the major version (e.g. 1.4 → 2.0)');
  console.log('    --version X.Y    Set the version explicitly');
  console.log('    --date "<text>"  Override the entry date (default: this month)');
  console.log('    --dir <path>     Target guide directory (default: .)');
  console.log('');
}
