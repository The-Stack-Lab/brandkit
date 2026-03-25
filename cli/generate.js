var fs = require('fs');
var path = require('path');
var extractTailwind = require('../lib/extract-tailwind');
var extractCSS = require('../lib/extract-css');
var extractLogos = require('../lib/extract-logos');
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
    summary.push('    Found Tailwind config — extracting colors, fonts, spacing');
    extracted.tailwindColors = tw.colors;
  }
  if (tw.fonts) extracted.tailwindFonts = tw.fonts;
  if (tw.spacing) extracted.tailwindSpacing = tw.spacing;

  // Extract CSS custom properties
  var cssVars = extractCSS.extract(projectDir);
  if (cssVars) {
    summary.push('    Found CSS custom properties — extracting theme variables');
    extracted.cssVars = cssVars;
  }

  // Extract logos
  var logos = extractLogos.extract(projectDir);
  if (logos && logos.length) {
    var logoNames = logos.map(function (l) { return path.basename(Object.values(l.variants)[0]); });
    summary.push('    Found ' + logoNames.join(', ') + ' — adding to logos');
    extracted.logos = logos;
  }

  if (!summary.length) {
    summary.push('    No Tailwind config, CSS variables, or logo assets detected');
    summary.push('    Creating starter config with __TODO markers');
  }

  summary.forEach(function (line) { console.log(line); });

  // Load existing config or create starter
  var configPath = path.join(brandDir, 'config.json');
  var existingConfig = null;
  if (fs.existsSync(configPath)) {
    try {
      existingConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      console.log('    Found existing config.json — preserving manual fields');
    } catch (_) {
      console.log('    Existing config.json is invalid — creating fresh');
    }
  }

  var baseConfig = existingConfig || schema.starterConfig();

  // Build extracted config fields
  var newFields = {};

  // Colors from Tailwind
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

  // Logos
  if (extracted.logos) {
    // Make paths relative to brand dir
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
  if (extracted.tailwindColors) console.log('    Colors: ' + extracted.tailwindColors.length + ' extracted');
  if (extracted.tailwindFonts) console.log('    Fonts: ' + Object.keys(extracted.tailwindFonts).length + ' detected');
  if (extracted.tailwindSpacing) console.log('    Spacing: ' + extracted.tailwindSpacing.length + ' tokens');
  if (extracted.logos) console.log('    Logos: ' + extracted.logos.length + ' files found');
  if (todoCount > 0) console.log('    TODO: ' + todoCount + ' fields need manual or AI attention');
  console.log('');
};

function buildColors(colorList) {
  // Simple heuristic: group into brand, neutrals, semantic
  var brand = [];
  var neutrals = [];
  var semantic = [];

  var semanticNames = ['success', 'warning', 'error', 'danger', 'info'];
  var neutralNames = ['gray', 'grey', 'slate', 'zinc', 'neutral', 'stone', 'black', 'white'];

  for (var i = 0; i < colorList.length; i++) {
    var c = colorList[i];
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

    var entry = {
      name: c.name,
      hex: c.hex,
      oklch: '',
      cssVar: '--color-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: c.role || ''
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
