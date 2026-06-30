var fs = require('fs');
var path = require('path');
var resolve = require('../lib/resolve');
var schema = require('../lib/config-schema');
var agentsDoc = require('../lib/agents-doc').agentsDoc;

module.exports = function init(args) {
  var targetDir = path.resolve(args[0] || 'brand');
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

  // Check for --update flag: only update engine files, preserve config
  var isUpdate = args.indexOf('--update') !== -1;

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
    fs.writeFileSync(configPath, JSON.stringify(starter, null, 2) + '\n');
    console.log('    created config.json');
  } else if (isUpdate) {
    console.log('    kept    config.json (--update)');
  } else {
    console.log('    kept    config.json (already exists)');
  }

  // Maintenance contract for agents/humans working in this dir — written when
  // absent (so older guides pick it up on --update) and never clobbered.
  var agentsPath = path.join(targetDir, 'AGENTS.md');
  if (!fs.existsSync(agentsPath)) {
    fs.writeFileSync(agentsPath, agentsDoc());
    console.log('    created AGENTS.md');
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
