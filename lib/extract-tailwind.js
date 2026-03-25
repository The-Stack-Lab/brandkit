var fs = require('fs');
var path = require('path');

/**
 * Extract colors, fonts, and spacing from a Tailwind config file.
 * Supports tailwind.config.js and tailwind.config.ts (via regex parsing).
 */
function extract(projectDir) {
  var result = { colors: null, fonts: null, spacing: null };

  // Find tailwind config
  var jsPath = path.join(projectDir, 'tailwind.config.js');
  var tsPath = path.join(projectDir, 'tailwind.config.ts');
  var mjsPath = path.join(projectDir, 'tailwind.config.mjs');

  var configPath = null;
  if (fs.existsSync(jsPath)) configPath = jsPath;
  else if (fs.existsSync(mjsPath)) configPath = mjsPath;
  else if (fs.existsSync(tsPath)) configPath = tsPath;

  if (!configPath) return result;

  var content = fs.readFileSync(configPath, 'utf8');

  // Try to require JS config directly
  if (configPath.endsWith('.js')) {
    try {
      var config = require(configPath);
      if (config.theme) {
        result.colors = extractColorsFromTheme(config.theme);
        result.fonts = extractFontsFromTheme(config.theme);
        result.spacing = extractSpacingFromTheme(config.theme);
      }
      return result;
    } catch (_) {
      // Fall through to regex parsing
    }
  }

  // Regex parsing for TS or failed JS require
  result.colors = extractColorsFromText(content);
  result.fonts = extractFontsFromText(content);

  return result;
}

function extractColorsFromTheme(theme) {
  var colors = theme.extend && theme.extend.colors ? theme.extend.colors : theme.colors;
  if (!colors || typeof colors !== 'object') return null;

  var result = [];
  flattenColors(colors, '', result);
  return result.length ? result : null;
}

function flattenColors(obj, prefix, result) {
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = obj[key];
    var name = prefix ? prefix + '-' + key : key;

    if (typeof value === 'string' && value.match(/^#|^rgb|^hsl|^oklch/)) {
      result.push({ name: name, hex: value, role: '' });
    } else if (typeof value === 'object' && value !== null) {
      if (value.DEFAULT) {
        result.push({ name: name, hex: value.DEFAULT, role: '' });
      }
      flattenColors(value, name, result);
    }
  }
}

function extractFontsFromTheme(theme) {
  var fontFamily = theme.extend && theme.extend.fontFamily ? theme.extend.fontFamily : theme.fontFamily;
  if (!fontFamily || typeof fontFamily !== 'object') return null;

  var result = {};
  var keys = Object.keys(fontFamily);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = fontFamily[key];
    var family = Array.isArray(value) ? value[0] : value;
    if (typeof family === 'string') {
      // Map common keys to display/body
      if (key === 'sans' || key === 'body' || key === 'text') {
        result.body = { family: family.replace(/['"]/g, '') };
      } else if (key === 'display' || key === 'heading' || key === 'serif') {
        result.display = { family: family.replace(/['"]/g, '') };
      }
    }
  }
  return Object.keys(result).length ? result : null;
}

function extractSpacingFromTheme(theme) {
  var spacing = theme.extend && theme.extend.spacing ? theme.extend.spacing : theme.spacing;
  if (!spacing || typeof spacing !== 'object') return null;

  var result = [];
  var keys = Object.keys(spacing);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = spacing[key];
    if (typeof value === 'string' && value.match(/^\d/)) {
      var px = parseFloat(value);
      if (value.endsWith('rem')) px = px * 16;
      if (!isNaN(px)) {
        result.push({ px: Math.round(px), token: 'space-' + key });
      }
    }
  }
  return result.length ? result.sort(function (a, b) { return a.px - b.px; }) : null;
}

function extractColorsFromText(content) {
  var colorMatches = [];
  var regex = /['"]?([\w-]+)['"]?\s*:\s*['"]?(#[0-9a-fA-F]{3,8})['"]?/g;
  var match;
  while ((match = regex.exec(content)) !== null) {
    colorMatches.push({ name: match[1], hex: match[2], role: '' });
  }
  return colorMatches.length ? colorMatches : null;
}

function extractFontsFromText(content) {
  var fontRegex = /fontFamily\s*:\s*\{([^}]+)\}/;
  var fontMatch = content.match(fontRegex);
  if (!fontMatch) return null;

  var result = {};
  var entryRegex = /['"]?(sans|body|display|heading|serif)['"]?\s*:\s*\[?\s*['"]([^'"]+)['"]/g;
  var match;
  while ((match = entryRegex.exec(fontMatch[1])) !== null) {
    var key = match[1];
    var family = match[2];
    if (key === 'sans' || key === 'body') {
      result.body = { family: family };
    } else {
      result.display = { family: family };
    }
  }
  return Object.keys(result).length ? result : null;
}

module.exports = { extract: extract };
