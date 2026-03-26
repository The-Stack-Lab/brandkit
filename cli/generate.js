var fs = require('fs');
var path = require('path');
var extractTailwind = require('../lib/extract-tailwind');
var extractCSS = require('../lib/extract-css');
var extractLogos = require('../lib/extract-logos');
var helpers = require('../lib/generate-helpers');
var schema = require('../lib/config-schema');

module.exports = function generate(args) {
  var brandDir = path.resolve(args[0] || 'brand');
  var projectDir = process.cwd();

  console.log('');
  console.log('  brandkit generate');
  console.log('');
  console.log('  Scanning project...');

  var extracted = {};
  var summary = [];

  // Extract from Tailwind config
  var tw = extractTailwind.extract(projectDir);
  if (tw.colors) {
    summary.push('    Found Tailwind config \u2014 extracting colors, fonts, spacing');
    extracted.tailwindColors = tw.colors;
  }
  if (tw.fonts) extracted.tailwindFonts = tw.fonts;
  if (tw.spacing) extracted.tailwindSpacing = tw.spacing;

  // Extract CSS custom properties
  var cssVars = extractCSS.extract(projectDir);
  if (cssVars) {
    summary.push('    Found CSS custom properties \u2014 extracting theme variables');
    extracted.cssVars = cssVars;
  }

  // Extract logos
  var logos = extractLogos.extract(projectDir);
  if (logos && logos.length) {
    var logoNames = logos.map(function (l) { return path.basename(Object.values(l.variants)[0]); });
    summary.push('    Found ' + logoNames.join(', ') + ' \u2014 adding to logos');
    extracted.logos = logos;
  }

  if (!summary.length) {
    summary.push('    No Tailwind config, CSS variables, or logo assets detected');
    summary.push('    Creating starter config with example entries');
  }

  // Load existing config or create starter
  var configPath = path.join(brandDir, 'config.json');
  var existingConfig = null;
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('    Found existing config.json \u2014 preserving manual fields');
    } catch (_) {
      console.log('    Existing config.json is invalid \u2014 creating fresh');
    }
  }

  var baseConfig = existingConfig || schema.starterConfig();

  // Build extracted config fields
  var newFields = {};

  // Colors from Tailwind (with auto-computed oklch and light flag)
  if (extracted.tailwindColors) {
    newFields.colors = buildColors(extracted.tailwindColors);
  }

  // Theme from CSS variables
  if (extracted.cssVars) {
    newFields.theme = extractCSS.mapToTheme(extracted.cssVars);
  }

  // Fonts from Tailwind
  if (extracted.tailwindFonts) {
    var fonts = {};
    if (extracted.tailwindFonts.display) {
      fonts.display = {
        family: extracted.tailwindFonts.display.family,
        googleImport: extracted.tailwindFonts.display.family + ':wght@300;400;500;600;700',
        description: '__TODO: Describe the display font.'
      };
    }
    if (extracted.tailwindFonts.body) {
      fonts.body = {
        family: extracted.tailwindFonts.body.family,
        googleImport: extracted.tailwindFonts.body.family + ':wght@300;400;500;600;700',
        description: '__TODO: Describe the body font.'
      };
    }
    if (Object.keys(fonts).length) newFields.fonts = fonts;
  }

  // Spacing from Tailwind
  if (extracted.tailwindSpacing) {
    newFields.spacing = extracted.tailwindSpacing;
  }

  // Logos (make paths relative to brand dir)
  if (extracted.logos) {
    newFields.logos = extracted.logos.map(function (logo) {
      var variants = {};
      var keys = Object.keys(logo.variants);
      for (var i = 0; i < keys.length; i++) {
        variants[keys[i]] = path.relative(brandDir, path.join(projectDir, logo.variants[keys[i]]));
      }
      return {
        name: logo.name,
        description: logo.description,
        variants: variants,
        background: logo.background
      };
    });
  }

  // --- Auto-compute derived fields ---
  // Only overwrite if existing field is empty or all-scaffold (__TODO)

  // Determine the theme to derive from (extracted or existing)
  var theme = newFields.theme || baseConfig.theme;

  // Auto-generate gradients from theme
  if (theme && isEmptyOrScaffold(baseConfig.gradients)) {
    var gradients = helpers.buildGradientsFromTheme(theme);
    if (gradients.length) {
      newFields.gradients = gradients;
      summary.push('    Gradients: ' + gradients.length + ' auto-generated from theme');
    }
  }

  // Auto-generate hierarchy from theme
  if (theme && isEmptyOrScaffold(baseConfig.hierarchy)) {
    newFields.hierarchy = helpers.buildHierarchyFromTheme(theme);
    summary.push('    Hierarchy: 4 levels auto-generated from theme colors');
  }

  // Auto-generate accessibility pairs from all extracted colors
  if (isEmptyOrScaffold(baseConfig.accessibility)) {
    var allColors = [];
    var colorSource = newFields.colors || baseConfig.colors;
    if (colorSource) {
      ['brand', 'neutrals', 'semantic'].forEach(function (key) {
        var group = colorSource[key];
        if (group) {
          var items = group.items || group;
          if (Array.isArray(items)) {
            allColors = allColors.concat(items);
          }
        }
      });
    }
    if (allColors.length) {
      var a11y = helpers.generateA11yPairs(allColors);
      if (a11y.length) {
        newFields.accessibility = a11y;
        summary.push('    Accessibility: ' + a11y.length + ' contrast pairs auto-computed');
      }
    }
  }

  // Auto-generate cssVariables from theme
  if (theme && isEmptyOrScaffold(baseConfig.cssVariables)) {
    var cssVarSections = helpers.buildCssVariablesFromTheme(theme);
    if (cssVarSections.length) {
      newFields.cssVariables = cssVarSections;
      summary.push('    CSS Variables: ' + cssVarSections.length + ' sections auto-generated');
    }
  }

  // Auto-scaffold typography if empty or missing
  if (isEmptyOrScaffold(baseConfig.typography)) {
    newFields.typography = helpers.scaffoldTypography();
    summary.push('    Typography: standard type scale scaffolded');
  }

  // Print all summary messages (including derived fields computed above)
  summary.forEach(function (line) { console.log(line); });

  // Merge
  var finalConfig = schema.mergeConfigs(baseConfig, newFields);

  // Ensure brand dir exists
  if (!fs.existsSync(brandDir)) {
    fs.mkdirSync(brandDir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2) + '\n');

  // Count what needs TODO attention
  var todoCount = countTodos(finalConfig);

  console.log('');
  console.log('  Generated ' + path.relative(process.cwd(), configPath));
  if (extracted.tailwindColors) console.log('    Colors: ' + extracted.tailwindColors.length + ' extracted (with oklch)');
  if (extracted.tailwindFonts) console.log('    Fonts: ' + Object.keys(extracted.tailwindFonts).length + ' detected');
  if (extracted.tailwindSpacing) console.log('    Spacing: ' + extracted.tailwindSpacing.length + ' tokens');
  if (extracted.logos) console.log('    Logos: ' + extracted.logos.length + ' files found');
  if (todoCount > 0) console.log('    TODO: ' + todoCount + ' fields need manual or AI attention');
  console.log('');
};

function buildColors(colorList) {
  var brand = [];
  var neutrals = [];
  var semantic = [];

  var semanticNames = ['success', 'warning', 'error', 'danger', 'info'];
  var neutralNames = ['gray', 'grey', 'slate', 'zinc', 'neutral', 'stone', 'black', 'white'];

  for (var i = 0; i < colorList.length; i++) {
    var c = colorList[i];
    // Skip colors without valid hex (Tailwind function-based colors, etc.)
    if (!c.hex || typeof c.hex !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(c.hex)) continue;
    if (!c.name) continue;
    var lowerName = c.name.toLowerCase();

    var isSemantic = false;
    var isNeutral = false;
    for (var j = 0; j < semanticNames.length; j++) {
      if (lowerName.indexOf(semanticNames[j]) !== -1) { isSemantic = true; break; }
    }
    if (!isSemantic) {
      for (var k = 0; k < neutralNames.length; k++) {
        if (lowerName.indexOf(neutralNames[k]) !== -1) { isNeutral = true; break; }
      }
    }

    // Auto-compute oklch and light flag
    var entry = {
      name: c.name,
      hex: c.hex,
      oklch: helpers.hexToOklch(c.hex),
      cssVar: '--color-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: c.role || '',
      light: helpers.isLightColor(c.hex)
    };

    if (isSemantic) semantic.push(entry);
    else if (isNeutral) neutrals.push(entry);
    else brand.push(entry);
  }

  return {
    brand: { label: 'Brand', items: brand },
    neutrals: { label: 'Neutrals', items: neutrals },
    semantic: { label: 'Semantic', items: semantic }
  };
}

function countTodos(obj) {
  var count = 0;
  var str = JSON.stringify(obj);
  var regex = /__TODO/g;
  while (regex.exec(str) !== null) count++;
  return count;
}

/**
 * Check if a field is empty or only contains scaffold/placeholder data.
 * Returns true if the field should be overwritten by auto-generation.
 */
function isEmptyOrScaffold(value) {
  if (!value) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  // Check if all entries are scaffold (contain __TODO)
  var str = JSON.stringify(value);
  if (str.indexOf('__TODO') !== -1) return true;
  return false;
}
