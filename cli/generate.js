var fs = require('fs');
var path = require('path');
var extractTailwind = require('../lib/extract-tailwind');
var extractCSS = require('../lib/extract-css');
var extractLogos = require('../lib/extract-logos');
var helpers = require('../lib/generate-helpers');
var schema = require('../lib/config-schema');
var ingest = require('../lib/ingest');

/**
 * Split `generate`'s flags from its positional brand directory.
 *
 * `--from` is repeatable and takes a URL, a directory, or a file; without it
 * `generate` behaves exactly as it always has (scan the host codebase), so
 * existing callers are unaffected.
 */
function parseArgs(args) {
  var opts = { dir: null, from: [], render: false, brandName: null };
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (a === '--from' && args[i + 1]) { opts.from.push(args[++i]); }
    else if (a.indexOf('--from=') === 0) { opts.from.push(a.slice(7)); }
    else if (a === '--render') { opts.render = true; }
    else if (a === '--brand-name' && args[i + 1]) { opts.brandName = args[++i]; }
    else if (a.indexOf('--brand-name=') === 0) { opts.brandName = a.slice(13); }
    else if (a.indexOf('-') !== 0 && !opts.dir) { opts.dir = a; }
  }
  return opts;
}

module.exports = function generate(args) {
  var cli = parseArgs(args || []);

  if (!cli.from.length) return run(cli, null);

  console.log('');
  console.log('  brandkit generate');
  console.log('');
  console.log('  Ingesting ' + cli.from.length + ' source(s)...');

  return ingest.ingest(cli.from, {
    brandName: cli.brandName,
    useRender: cli.render,
    log: function (line) { console.log(line); }
  }).then(function (result) {
    reportEvidence(result);
    run(cli, result);
  }).catch(function (e) {
    console.error('  Ingest failed: ' + (e && e.message ? e.message : String(e)));
    process.exitCode = 1;
  });
};

function run(cli, ingested) {
  var args = [cli.dir].filter(Boolean);
  var brandDir = path.resolve(args[0] || 'brand');
  var projectDir = process.cwd();

  if (!ingested) {
    console.log('');
    console.log('  brandkit generate');
    console.log('');
  }
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
    ensureThemeDefaults(newFields.theme);
  }

  // Ingested sources (--from) outrank a host-codebase scan: they describe the
  // brand as it actually renders, not whatever happens to sit in this repo.
  if (ingested) {
    var fromIngest = ingest.toConfigFields(ingested, { brandName: cli.brandName });
    if (fromIngest.theme) {
      newFields.theme = Object.assign({}, newFields.theme || {}, fromIngest.theme);
      ensureThemeDefaults(newFields.theme);
      summary.push('    Theme: ' + Object.keys(fromIngest.theme).length + ' token(s) from ingested sources');
    }
    if (fromIngest.fonts) {
      newFields.fonts = Object.assign({}, newFields.fonts || {}, fromIngest.fonts);
      summary.push('    Fonts: ' + Object.keys(fromIngest.fonts).join(', ') + ' from ingested sources');
    }
    if (fromIngest.logos) {
      newFields.logos = fromIngest.logos;
      summary.push('    Logos: ' + fromIngest.logos.length + ' ranked from ingested sources');
    }
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

  // Evidence lives beside config.json, never inside it: config.json is the
  // rendered source of truth and flows into the exports, while this is an
  // audit trail for whoever has to trust these tokens later.
  if (ingested) {
    fs.writeFileSync(
      path.join(brandDir, 'ingest-evidence.json'),
      JSON.stringify({
        sources: cli.from,
        rendered: cli.render,
        generatedAt: new Date().toISOString(),
        evidence: ingested.evidence,
        conflicts: ingested.conflicts,
        rejected: ingested.rejected,
        gaps: ingested.gaps,
        notes: ingested.notes
      }, null, 2) + '\n');
  }

  // Count what needs TODO attention
  var todoCount = countTodos(finalConfig);

  console.log('');
  console.log('  Generated ' + path.relative(process.cwd(), configPath));
  if (extracted.tailwindColors) console.log('    Colors: ' + extracted.tailwindColors.length + ' extracted (with oklch)');
  if (extracted.tailwindFonts) console.log('    Fonts: ' + Object.keys(extracted.tailwindFonts).length + ' detected');
  if (extracted.tailwindSpacing) console.log('    Spacing: ' + extracted.tailwindSpacing.length + ' tokens');
  if (extracted.logos) console.log('    Logos: ' + extracted.logos.length + ' files found');
  if (todoCount > 0) console.log('    TODO: ' + todoCount + ' fields need manual or AI attention');
  if (ingested) console.log('    Evidence: ingest-evidence.json');
  console.log('');
}

/**
 * Print what was measured, what was thrown out, and what is still missing.
 *
 * Gaps are reported as loudly as findings on purpose. A token nobody could
 * measure is a question for a human; silently filling it with a plausible
 * guess is how a brand guide ends up confidently describing the wrong brand.
 */
function reportEvidence(result) {
  var fields = Object.keys(result.evidence || {});
  console.log('');
  console.log('  Measured ' + fields.length + ' token(s):');
  fields.forEach(function (f) {
    var e = result.evidence[f];
    console.log('    ' + f + ': ' + e.value + '  [' + e.source + '/' + e.confidence + ']');
    console.log('      ' + e.detail);
  });

  if (result.conflicts && result.conflicts.length) {
    console.log('');
    console.log('  Conflicts resolved (measurement wins):');
    result.conflicts.forEach(function (c) {
      console.log('    ' + c.field + ': kept ' + c.chosen + ' (' + c.chosenSource +
                  ') over ' + c.rejected + ' from ' + c.rejectedSource);
    });
  }

  if (result.rejected && result.rejected.length) {
    console.log('');
    console.log('  Rejected:');
    result.rejected.forEach(function (r) {
      console.log('    ' + r.field + (r.value ? ' = ' + r.value : '') + ' — ' + r.reason);
    });
  }

  if (result.gaps && result.gaps.length) {
    console.log('');
    console.log('  Not measurable from these sources (left for you, not guessed):');
    result.gaps.forEach(function (g) { console.log('    ' + g); });
  }
  console.log('');
}

// Fill in the companion tokens styles.css consumes but a host stylesheet
// rarely defines: the "r, g, b" variants used by rgba() tints, and the
// accent on-color pairing. A light fill (e.g. orange) gets a black
// foreground so buttons stay legible; --accent-text defaults to the fill.
function ensureThemeDefaults(theme) {
  if (!theme) return;
  var rgbPairs = {
    '--accent': '--accent-rgb',
    '--ink': '--ink-rgb',
    '--error': '--error-rgb',
    '--success': '--success-rgb'
  };
  Object.keys(rgbPairs).forEach(function (hexKey) {
    var rgbKey = rgbPairs[hexKey];
    var val = theme[hexKey];
    if (val && !theme[rgbKey] && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
      theme[rgbKey] = helpers.hexToRgbString(val);
    }
  });
  if (theme['--accent'] && !theme['--accent-foreground'] && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(theme['--accent'])) {
    // Pick the on-fill color with the higher WCAG contrast (not a luminance
    // threshold — a mid-tone fill like orange reads better with black text
    // even though it isn't "light").
    var lum = helpers.relativeLuminance(theme['--accent']);
    var contrastWhite = 1.05 / (lum + 0.05);
    var contrastBlack = (lum + 0.05) / 0.05;
    theme['--accent-foreground'] = contrastBlack >= contrastWhite ? '#000000' : '#FFFFFF';
  }
  if (theme['--accent'] && !theme['--accent-text']) {
    theme['--accent-text'] = theme['--accent'];
  }
}

function buildColors(colorList) {
  var brand = [];
  var neutrals = [];
  var semantic = [];

  var semanticNames = ['success', 'warning', 'error', 'danger', 'info'];
  var neutralNames = ['gray', 'grey', 'slate', 'zinc', 'neutral', 'stone', 'black', 'white'];

  for (var i = 0; i < colorList.length; i++) {
    var c = colorList[i];
    // Skip colors without valid hex (Tailwind function-based colors, etc.)
    if (!c.hex || typeof c.hex !== 'string' || !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c.hex)) continue;
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
