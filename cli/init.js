var fs = require('fs');
var path = require('path');
var resolve = require('../lib/resolve');
var schema = require('../lib/config-schema');
var agentsDoc = require('../lib/agents-doc').agentsDoc;

module.exports = function init(args) {
  // `--` ends the options: everything after it is positional, so a directory
  // whose name starts with a dash stays expressible (`-- ./-weird-dir`), and
  // a literal `--update` after it is a path, not the flag. Split first, then
  // read flags out of the left side only: detecting the flag before finding
  // the separator meant `init -- --update` still ran in update mode.
  var sep = args.indexOf('--');
  var opts = sep === -1 ? args : args.slice(0, sep);
  var rest = sep === -1 ? [] : args.slice(sep + 1);
  var isUpdate = opts.indexOf('--update') !== -1;
  // Anything else with a leading dash is a typo, not a directory name:
  // `init --updates <dir>` used to scaffold into ./--updates.
  var unknown = opts.filter(function (a) {
    return a.charAt(0) === '-' && a !== '--update';
  })[0];
  if (unknown) {
    console.error('');
    console.error('  Unknown option: ' + unknown);
    console.error('  Usage: brandkit init [dir] [--update]');
    console.error('');
    process.exit(1);
  }
  var positional = opts.filter(function (a) { return a.charAt(0) !== '-'; }).concat(rest);
  var targetDir = path.resolve(positional[0] || 'brand');
  var distDir = resolve.getDistPath();

  console.log('');
  console.log('  brandkit');
  console.log('');
  console.log('  Scaffolding into ' + path.relative(process.cwd(), targetDir) + '/...');

  // Create target directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Create logos directory
  var logosDir = path.join(targetDir, 'logos');
  if (!fs.existsSync(logosDir)) {
    fs.mkdirSync(logosDir, { recursive: true });
  }

  // Copy engine files from dist/
  var files = ['engine.js', 'styles.css', 'index.html', 'changelog.html', 'changelog.js'];
  for (var i = 0; i < files.length; i++) {
    var src = path.join(distDir, files[i]);
    var dest = path.join(targetDir, files[i]);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log('    copied  ' + files[i]);
    }
  }

  // Copy the default showcase logos so the scaffold renders complete out of
  // the box. Skipped on --update (preserve the user's assets) and skipped per
  // file if the user already has one with that name.
  var distLogosDir = path.join(distDir, 'logos');
  if (!isUpdate && fs.existsSync(distLogosDir)) {
    var logoFiles = fs.readdirSync(distLogosDir);
    for (var l = 0; l < logoFiles.length; l++) {
      var logoSrc = path.join(distLogosDir, logoFiles[l]);
      var logoDest = path.join(logosDir, logoFiles[l]);
      if (!fs.existsSync(logoDest)) {
        fs.copyFileSync(logoSrc, logoDest);
        console.log('    copied  logos/' + logoFiles[l]);
      }
    }
  }

  // Create starter config.json (skip if exists and not forcing)
  var configPath = path.join(targetDir, 'config.json');
  if (!fs.existsSync(configPath) && !isUpdate) {
    var starter = schema.starterConfig();
    // Name the guide after the host project rather than after brandkit. What
    // can't be read from package.json is left as an explicit __TODO so it
    // shows up in the TODO count instead of shipping brandkit's own copy.
    // Seed from the project that owns the guide directory, not from wherever
    // the command happened to be run: `init packages/client/brand` from a
    // monorepo root must name the client, not the monorepo.
    var seeded = schema.seedBrandIdentity(starter, targetDir);
    fs.writeFileSync(configPath, JSON.stringify(starter, null, 2) + '\n');
    console.log('    created config.json');
    if (seeded) {
      console.log('    seeded  brand.name = "' + starter.brand.name +
                  '" from package.json (tagline/description left as __TODO)');
    }
  } else if (isUpdate && !fs.existsSync(configPath)) {
    console.log('    MISSING config.json: engine files updated, but this is not');
    console.log('            a guide yet. Run `brandkit init ' +
                path.relative(process.cwd(), targetDir) + '` to scaffold one.');
  } else if (isUpdate) {
    console.log('    kept    config.json (--update)');
  } else {
    console.log('    kept    config.json (already exists)');
  }

  // Maintenance contract for agents/humans working in this dir. It is
  // brand-agnostic generated documentation, like the engine files beside it,
  // so --update refreshes it rather than skipping it: a guide installed before
  // a rule existed (the chrome/content split, say) would otherwise keep handing
  // its agent an outdated contract forever. Local additions to this file are
  // overwritten; put guide-specific notes in the host project instead.
  var agentsPath = path.join(targetDir, 'AGENTS.md');
  var hadAgents = fs.existsSync(agentsPath);
  if (isUpdate || !hadAgents) {
    fs.writeFileSync(agentsPath, agentsDoc());
    console.log((hadAgents ? '    wrote   ' : '    created ') + 'AGENTS.md (maintenance contract)');
  } else {
    console.log('    kept    AGENTS.md (already exists)');
  }

  console.log('');
  if (isUpdate) {
    console.log('  Updated engine files. Config and logos preserved.');
  } else {
    console.log('  Next steps:');
    console.log('    1. Edit ' + path.relative(process.cwd(), configPath) + ' with your brand data');
    console.log('    2. Add logo files to ' + path.relative(process.cwd(), logosDir) + '/');
    console.log('    3. Run: npx brandkit dev ' + path.relative(process.cwd(), targetDir));
  }
  console.log('');
};
