#!/usr/bin/env node

var args = process.argv.slice(2);
var command = args[0] || 'help';

switch (command) {
  case 'init':
    require('../cli/init')(args.slice(1));
    break;
  case 'dev':
    require('../cli/dev')(args.slice(1));
    break;
  case 'build':
    require('../cli/build')(args.slice(1));
    break;
  case 'generate':
    require('../cli/generate')(args.slice(1));
    break;
  case 'help':
  case '--help':
  case '-h':
    printHelp();
    break;
  case '--version':
  case '-v':
    var pkg = require('../package.json');
    console.log(pkg.version);
    break;
  default:
    console.error('Unknown command: ' + command);
    printHelp();
    process.exit(1);
}

function printHelp() {
  console.log('');
  console.log('  brandkit — config-driven brand guide');
  console.log('');
  console.log('  Usage:');
  console.log('    brandkit init [dir]        Scaffold a new brand guide');
  console.log('    brandkit generate [dir]    Auto-generate config from codebase');
  console.log('    brandkit dev [dir]         Start dev server with live reload');
  console.log('    brandkit build [dir]       Build static files for production');
  console.log('');
  console.log('  Options:');
  console.log('    --help, -h     Show this help message');
  console.log('    --version, -v  Show version number');
  console.log('');
}
