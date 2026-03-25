var fs = require('fs');
var path = require('path');

/**
 * Extract CSS custom properties from CSS files in a project.
 * Looks for :root blocks and @theme blocks.
 */
function extract(projectDir) {
  var cssFiles = findCSSFiles(projectDir);
  var allVars = {};

  for (var i = 0; i < cssFiles.length; i++) {
    var content = fs.readFileSync(cssFiles[i], 'utf8');
    var vars = extractFromContent(content);
    var keys = Object.keys(vars);
    for (var j = 0; j < keys.length; j++) {
      allVars[keys[j]] = vars[keys[j]];
    }
  }

  return Object.keys(allVars).length ? allVars : null;
}

function findCSSFiles(dir) {
  var results = [];
  var searchDirs = [
    path.join(dir, 'src'),
    path.join(dir, 'app'),
    path.join(dir, 'styles'),
    dir
  ];

  for (var i = 0; i < searchDirs.length; i++) {
    if (!fs.existsSync(searchDirs[i])) continue;
    scanDir(searchDirs[i], results, 0);
  }
  return results;
}

function scanDir(dir, results, depth) {
  if (depth > 3) return; // Don't go too deep
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      scanDir(fullPath, results, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      results.push(fullPath);
    }
  }
}

function extractFromContent(content) {
  var vars = {};

  // Match :root { ... } blocks
  var rootRegex = /:root\s*\{([^}]+)\}/g;
  var match;
  while ((match = rootRegex.exec(content)) !== null) {
    parseVarBlock(match[1], vars);
  }

  // Match @theme { ... } blocks (Tailwind v4)
  var themeRegex = /@theme\s*\{([^}]+)\}/g;
  while ((match = themeRegex.exec(content)) !== null) {
    parseVarBlock(match[1], vars);
  }

  return vars;
}

function parseVarBlock(block, vars) {
  var lineRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  var match;
  while ((match = lineRegex.exec(block)) !== null) {
    vars[match[1].trim()] = match[2].trim();
  }
}

/**
 * Map extracted CSS variables to brandkit theme format.
 * Recognizes common shadcn/ui and Tailwind variable names.
 */
function mapToTheme(cssVars) {
  if (!cssVars) return null;

  var mapping = {
    '--background': '--cloud',
    '--foreground': '--ink',
    '--primary': '--purple',
    '--secondary': '--mist',
    '--muted': '--mist',
    '--muted-foreground': '--slate',
    '--accent': '--coral',
    '--destructive': '--error',
    '--border': '--mist'
  };

  var theme = {};
  var keys = Object.keys(cssVars);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var mappedKey = mapping[key] || key;
    theme[mappedKey] = cssVars[key];
  }

  return theme;
}

module.exports = { extract: extract, mapToTheme: mapToTheme };
