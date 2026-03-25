var fs = require('fs');
var path = require('path');
var resolve = require('../lib/resolve');
var template = require('../lib/template');

module.exports = function build(args) {
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

  template.build(distDir, targetDir, config);

  var brandName = (config.brand && config.brand.displayName) || 'Brand';
  console.log('    built   index.html   (' + brandName + ' title + fonts baked in)');
  console.log('    built   styles.css   (:root variables generated)');
  console.log('    copied  engine.js');
  console.log('');
  console.log('  Ready to deploy. Serve ' + path.relative(process.cwd(), targetDir) + '/ as static files.');
  console.log('');
};
