/**
 * Regenerate example/ from the starter, dist/ and the exporters.
 *
 *   node scripts/sync-example.js
 *
 * The demo's changelog and date are curated history and live ONLY in
 * example/config.json, so they are read back and preserved. An earlier version
 * of this recipe hardcoded a changelog inline; it went stale, and running it
 * during 1.7.0 silently wiped four releases of history from the demo.
 *
 * To cut a release: bump package.json, prepend a { version, date, changes }
 * entry to example/config.json (and set brand.date), then run this.
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');
var pkg = require(path.join(root, 'package.json'));
var schema = require(path.join(root, 'lib', 'config-schema'));
var exporter = require(path.join(root, 'lib', 'export'));
var agentsDoc = require(path.join(root, 'lib', 'agents-doc')).agentsDoc;

var exampleDir = path.join(root, 'example');
var configPath = path.join(exampleDir, 'config.json');
var existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));

var next = schema.starterConfig();
next.brand.version = pkg.version;
next.brand.date = existing.brand.date;
next.changelog = existing.changelog;

if (!next.changelog.length || next.changelog[0].version !== pkg.version) {
  console.error('  example/config.json: newest changelog entry is ' +
    (next.changelog.length ? 'v' + next.changelog[0].version : 'missing') +
    ', package.json is v' + pkg.version + '. Prepend an entry for this release first.');
  process.exit(1);
}

fs.writeFileSync(configPath, JSON.stringify(next, null, 2) + '\n');
['engine.js', 'styles.css', 'index.html', 'changelog.html', 'changelog.js'].forEach(function (f) {
  fs.copyFileSync(path.join(root, 'dist', f), path.join(exampleDir, f));
});
exporter.writeExports(next, exampleDir, 'all');
fs.writeFileSync(path.join(exampleDir, 'AGENTS.md'), agentsDoc());
console.log('  example/ synced to v' + pkg.version + ' (' + next.changelog.length + ' changelog entries kept)');
