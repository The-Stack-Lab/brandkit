var fs = require('fs');
var path = require('path');

/**
 * Find logo/brand asset files in a project.
 * Looks in common asset directories for files matching brand-related patterns.
 */
function extract(projectDir) {
  var searchDirs = [
    path.join(projectDir, 'public'),
    path.join(projectDir, 'static'),
    path.join(projectDir, 'src', 'assets'),
    path.join(projectDir, 'assets'),
    path.join(projectDir, 'images'),
    path.join(projectDir, 'img')
  ];

  var patterns = [/logo/i, /brand/i, /mark/i, /icon/i, /wordmark/i, /lockup/i];
  var extensions = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];

  var found = [];

  for (var i = 0; i < searchDirs.length; i++) {
    if (!fs.existsSync(searchDirs[i])) continue;
    scanForLogos(searchDirs[i], patterns, extensions, found, projectDir, 0);
  }

  if (!found.length) return null;

  // Convert to brandkit logo format
  return found.map(function (file) {
    var ext = path.extname(file.path).toLowerCase();
    var basename = path.basename(file.path, ext);
    var relativePath = file.relativePath;

    // Determine background hint from filename
    var background = 'light';
    if (/white|light|reversed/i.test(basename)) background = 'dark';
    else if (/dark|black/i.test(basename)) background = 'light';

    var variants = {};
    var format = ext === '.svg' ? 'svg' : (ext === '.png' ? 'png' : 'jpg');
    variants[format] = relativePath;

    return {
      name: prettifyName(basename),
      description: '',
      variants: variants,
      background: background
    };
  });
}

function scanForLogos(dir, patterns, extensions, results, projectDir, depth) {
  if (depth > 3) return;
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);

    if (entry.isDirectory() && entry.name !== 'node_modules') {
      scanForLogos(fullPath, patterns, extensions, results, projectDir, depth + 1);
    } else if (entry.isFile()) {
      var ext = path.extname(entry.name).toLowerCase();
      if (extensions.indexOf(ext) === -1) continue;

      var matchesPattern = false;
      for (var j = 0; j < patterns.length; j++) {
        if (patterns[j].test(entry.name)) {
          matchesPattern = true;
          break;
        }
      }

      if (matchesPattern) {
        results.push({
          path: fullPath,
          relativePath: path.relative(projectDir, fullPath)
        });
      }
    }
  }
}

function prettifyName(basename) {
  return basename
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, function (c) { return c.toUpperCase(); })
    .trim();
}

module.exports = { extract: extract };
