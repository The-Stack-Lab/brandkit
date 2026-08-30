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
    if (a === '--from') {
      if (!args[i + 1] || args[i + 1].indexOf('-') === 0) { opts.danglingFrom = true; }
      else { opts.from.push(args[++i]); }
    }
    else if (a.indexOf('--from=') === 0) { opts.from.push(a.slice(7)); }
    else if (a === '--render') { opts.render = true; }
    else if (a === '--brand-name') {
      // Guard the same way as --from: without this, `--brand-name --render`
      // silently takes "--render" as the brand name and drops the flag.
      if (!args[i + 1] || args[i + 1].indexOf('-') === 0) { opts.danglingBrandName = true; }
      else { opts.brandName = args[++i]; }
    }
    else if (a.indexOf('--brand-name=') === 0) { opts.brandName = a.slice(13); }
    else if (a.indexOf('-') !== 0 && !opts.dir) { opts.dir = a; }
  }
  return opts;
}

module.exports = function generate(args) {
  var cli = parseArgs(args || []);

  if (cli.danglingFrom) {
    console.error('');
    console.error('  --from needs a value: a URL, a directory, or a file.');
    console.error('  e.g. brandkit generate brand --from ./context/source-site');
    console.error('       brandkit generate brand --from https://client.com');
    console.error('');
    process.exitCode = 1;
    return;
  }

  if (cli.danglingBrandName) {
    console.error('');
    console.error('  --brand-name needs a value.');
    console.error('  e.g. brandkit generate brand --from ./archive --brand-name "Acme Co"');
    console.error('');
    process.exitCode = 1;
    return;
  }

  if (!cli.from.length) {
    try {
      return run(cli, null);
    } catch (e) {
      // Without this the same fault escapes bin/brandkit.js as a raw stack.
      return reportWriteFailure(e);
    }
  }

  console.log('');
  console.log('  brandkit generate');
  console.log('');
  console.log('  Ingesting ' + cli.from.length + ' source(s)...');

  return ingest.ingest(cli.from, {
    brandName: cli.brandName,
    useRender: cli.render,
    log: function (line) { console.log(line); }
  }).then(function (result) {
    // Every source failed. Writing a config here would look like success while
    // measuring nothing — the exact silent-wrongness this feature exists to
    // stop. Fail loudly and leave config.json alone.
    if (!result.usable) {
      console.error('');
      console.error('  None of the ' + cli.from.length + ' source(s) yielded anything measurable.');
      (result.notes || []).forEach(function (n) { console.error('    - ' + n); });
      console.error('');
      console.error('  config.json was NOT modified. Check the path or URL and try again.');
      console.error('');
      process.exitCode = 1;
      return;
    }
    reportEvidence(result);
    // Kept out of the ingest .catch: a failure writing config.json is not an
    // ingest failure, and reporting it as one sends you looking in the wrong
    // place. Same fault, same message, whether or not --from was used.
    try {
      run(cli, result);
    } catch (e) {
      reportWriteFailure(e);
    }
  }).catch(function (e) {
    console.error('');
    console.error('  Ingest failed: ' + (e && e.message ? e.message : String(e)));
    console.error('');
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

  // Identity, if the brand block is still brandkit's untouched scaffold. A
  // guide generated inside another project should never introduce itself as
  // brandkit — brand.md is the artifact that goes to a client for approval.
  // seedBrandIdentity() no-ops once brand.name has been edited, so re-running
  // generate never overwrites real work.
  if (schema.seedBrandIdentity(baseConfig, projectDir)) {
    summary.push('    Brand: seeded name "' + baseConfig.brand.name +
                 '" from package.json (tagline/description left as __TODO)');
  }

  // Build extracted config fields
  var newFields = {};

  // Colors: the Tailwind config first, then every color-valued CSS custom
  // property. Tailwind 4 is CSS-first and ships no config file, so the
  // stylesheet is the only place a modern project's palette exists.
  var colorList = [];
  if (extracted.tailwindColors) colorList = colorList.concat(extracted.tailwindColors);
  if (extracted.cssVars) colorList = colorList.concat(colorsFromCssVars(extracted.cssVars));
  if (colorList.length) {
    newFields.colors = buildColors(colorList);
    var swatchCount = newFields.colors.brand.items.length +
      newFields.colors.neutrals.items.length +
      newFields.colors.semantic.items.length;
    summary.push('    Colors: ' + swatchCount + ' swatch(es) extracted');
  }

  // Theme from CSS variables
  if (extracted.cssVars) {
    newFields.theme = extractCSS.mapToTheme(extracted.cssVars, {
      warn: function (msg) { summary.push('    Warning: ' + msg); }
    });
    ensureThemeDefaults(newFields.theme);
  }

  // Fonts — a tailwind.config.* entry is explicit intent and wins; CSS custom
  // properties fill whatever it does not cover. Tailwind 4 is CSS-first and
  // has no config file at all, so without the CSS path brandkit's own default
  // typeface survived as if it were the host project's.
  var cssFonts = extracted.cssVars ? extractCSS.fontsFromVars(extracted.cssVars) : null;
  if (extracted.tailwindFonts || cssFonts) {
    var fontSources = { display: null, body: null };
    ['display', 'body'].forEach(function (slot) {
      var tw = extracted.tailwindFonts && extracted.tailwindFonts[slot];
      if (tw && tw.family) { fontSources[slot] = { family: tw.family, from: 'tailwind.config' }; return; }
      if (cssFonts && cssFonts[slot]) {
        fontSources[slot] = {
          family: cssFonts[slot].family,
          from: 'CSS custom properties',
          inferred: cssFonts[slot].inferred
        };
      }
    });

    var fonts = {};
    var fontNotes = [];
    ['display', 'body'].forEach(function (slot) {
      var picked = fontSources[slot];
      if (!picked) return;
      // A family read off a next/font variable name is a guess: the binding
      // `--font-geist-sans` belongs to the family "Geist", not "Geist Sans".
      // Emitting a googleImport for it ships an @import that 404s, so leave it
      // empty (both link builders skip a falsy googleImport) and say plainly
      // in the description that the name needs confirming — which puts it in
      // the TODO count instead of passing a guess off as resolved.
      fonts[slot] = {
        family: picked.family,
        googleImport: picked.inferred ? '' : picked.family + ':wght@300;400;500;600;700',
        description: picked.inferred
          ? '__TODO: Family inferred from the CSS variable name — confirm the real ' +
            'typeface and set googleImport before publishing.'
          : '__TODO: Describe the ' + slot + ' font.'
      };
      fontNotes.push(slot + ' = ' + picked.family +
        ' (' + picked.from + (picked.inferred ? ', inferred — needs confirming' : '') + ')');
    });
    if (Object.keys(fonts).length) {
      newFields.fonts = fonts;
      summary.push('    Fonts: ' + fontNotes.join(', '));
    }
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

function reportWriteFailure(e) {
  console.error('');
  console.error('  Could not write the brand config: ' + (e && e.message ? e.message : String(e)));
  console.error('');
  process.exitCode = 1;
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
  Object.keys(rgbPairs).forEach(function (colorKey) {
    var rgbKey = rgbPairs[colorKey];
    var val = theme[colorKey];
    // Any parseable color, not hex alone — an oklch accent needs its tint
    // triple just as much, and rgba(var(--accent-rgb), …) cannot consume
    // oklch text.
    if (val && !theme[rgbKey] && helpers.parseCssColor(val)) {
      theme[rgbKey] = helpers.hexToRgbString(val);
    }
  });
  if (theme['--accent'] && !theme['--accent-foreground'] && helpers.parseCssColor(theme['--accent'])) {
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

function humanizeVarName(key) {
  return String(key).replace(/^--/, '').split(/[-_]+/).filter(Boolean).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

/**
 * Every color-valued CSS custom property, as swatch candidates.
 *
 * `colors` was previously sourced *only* from a Tailwind config file, so a
 * Tailwind 4 CSS-first project — which has no such file — kept brandkit's
 * placeholder indigo palette in the guide handed to the client, no matter
 * what the host stylesheet actually declared.
 */
function colorsFromCssVars(cssVars) {
  var out = [];
  if (!cssVars) return out;
  Object.keys(cssVars).forEach(function (key) {
    if (/-rgb$/.test(key)) return;   // tint triple, not a color
    if (/^--font-/.test(key)) return; // font stack
    if (!helpers.parseCssColor(cssVars[key])) return;
    // Hand on the authored text; buildColors re-parses and keeps the original.
    out.push({ name: humanizeVarName(key), hex: cssVars[key], role: '' });
  });
  return out;
}

function buildColors(colorList) {
  var brand = [];
  var neutrals = [];
  var semantic = [];
  // Null-prototype: a bare {} inherits Object.prototype, so a token named
  // --constructor or --toString would test as already-seen and be dropped
  // before it was ever added.
  var seen = Object.create(null);

  var semanticNames = ['success', 'warning', 'error', 'danger', 'info', 'destructive'];
  var neutralNames = ['gray', 'grey', 'slate', 'zinc', 'neutral', 'stone', 'black', 'white',
    'background', 'foreground', 'border', 'input', 'ring', 'card', 'popover',
    'muted', 'secondary'];

  for (var i = 0; i < colorList.length; i++) {
    var c = colorList[i];
    if (!c.name) continue;
    // Accept any CSS color, not hex alone. extract-tailwind already collects
    // oklch/rgb/hsl values and a Tailwind 4 project is oklch throughout, so a
    // hex-only test here silently discarded the host's entire palette and
    // left brandkit's own placeholder swatches in the client-facing guide.
    var parsed = helpers.parseCssColor(c.hex);
    if (!parsed) continue;
    var lowerName = c.name.toLowerCase();
    // Dedupe by name AND by resolved color: a shadcn theme aliases the same
    // value under several names (--brand / --primary / --color-primary), which
    // would otherwise render as three identical swatches in the palette. The
    // earlier source wins, so the Tailwind config and the most primitive token
    // name keep their place.
    if (seen[lowerName] || seen[parsed.hex]) continue;
    seen[lowerName] = true;
    seen[parsed.hex] = true;

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

    // Swatches render from hex; `oklch` is the display string shown beside
    // them. When the author wrote a non-hex space, keep their exact text so
    // the guide can quote the source of truth rather than a conversion.
    var entry = {
      name: c.name,
      hex: parsed.hex,
      oklch: parsed.space === 'oklch' ? parsed.original : helpers.hexToOklch(parsed.hex),
      cssVar: '--color-' + c.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      role: c.role || '',
      light: helpers.isLightColor(parsed.hex)
    };
    // Record the authored text whenever it differs from the hex actually
    // rendered — that includes an alpha hex, whose transparency is dropped.
    if (parsed.original.toUpperCase() !== parsed.hex) entry.authored = parsed.original;

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
