/**
 * Runs every test/*.test.js and reports every failure.
 *
 * `npm test` used to chain the files with &&, so one failing file silently
 * skipped every file after it: a red exports test hid the basepath and chrome
 * suites entirely. Each file runs in its own process (they set process state
 * and exit), and the runner exits non-zero if any of them did.
 */
var fs = require('fs');
var path = require('path');
var spawnSync = require('child_process').spawnSync;

var files = fs.readdirSync(__dirname)
  .filter(function (f) { return /\.test\.js$/.test(f); })
  .sort();

var failed = [];
files.forEach(function (f) {
  console.log('\n== ' + f);
  var r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f + (r.signal ? ' (' + r.signal + ')' : ' (exit ' + r.status + ')'));
});

console.log('\n' + (files.length - failed.length) + ' of ' + files.length + ' test files passed.');
if (failed.length) {
  console.log('Failed:\n  ' + failed.join('\n  '));
  process.exit(1);
}
