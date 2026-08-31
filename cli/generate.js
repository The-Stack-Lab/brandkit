var fs = require('fs');
var path = require('path');
var extractTailwind = require('../lib/extract-tailwind');
var extractCSS = require('../lib/extract-css');
var extractLogos = require('../lib/extract-logos');
var helpers = require('../lib/generate-helpers');
var schema = require('../lib/config-schema');
var ingest = require('../lib/ingest');
var unfilled = require('../lib/unfilled');

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
      console.log('    Found existing config.json');
    } catch (_) {
      console.log('    Existing config.json is invalid \u2014 creating fresh');
    }
  }

  var baseConfig = existingConfig || schema.starterConfig();

  // brandkit's own repo legitimately carries brandkit's content — the demo IS
  // the brand. Provenance stripping applies only where the guide documents
  // somebody else. hostBrandIdentity() is the right signal; seedBrandIdentity()
  // returns false on every run after the first, so it says nothing about whose
  // content this is.
  // Fails CLOSED: anything not demonstrably brandkit's own repo is treated as
  // documenting somebody else's brand. The previous signal
  // (`hostBrandIdentity() !== null`) failed OPEN — no package.json meant no
  // stripping at all, so brandkit's voice and tagline shipped to the client.
  var documentsAnotherBrand = !schema.isBrandkitRepo(projectDir);
  var scaffold = schema.starterConfig();
  var stripped = [];   // content removed because it was brandkit's
  var rederived = [];  // content recomputed from this project's own theme
  function needsRegeneration(field, key) {
    if (isEmptyOrScaffold(field)) return true;
    if (documentsAnotherBrand && isStillScaffold(field, scaffold[key])) {
      // Reported as re-derived, not removed: these fields get a real
      // replacement computed from the host's theme. Calling that "removed" sent
      // people looking for content that is present and correct.
      rederived.push(key);
      return true;
    }
    return false;
  }

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

  // Extraction can come back empty — no Tailwind config, no parseable custom
  // properties. `mergeConfigs` only touches colours and fonts when there is
  // something to merge, so the starter's indigo palette and Space Grotesk
  // survived as the client's own, marker-free and therefore invisible to both
  // the TODO report and the build gate. Mark them unfilled instead.
  function clearIfScaffold(key, replacement, label) {
    if (!documentsAnotherBrand) return;
    if (!isStillScaffold(baseConfig[key], scaffold[key])) return;
    newFields[key] = replacement;
    stripped.push(label || key);
  }

  // Colors: the Tailwind config first, then every color-valued CSS custom
  // property. Tailwind 4 is CSS-first and ships no config file, so the
  // stylesheet is the only place a modern project's palette exists.
  var colorList = [];
  if (extracted.tailwindColors) colorList = colorList.concat(extracted.tailwindColors);
  if (extracted.cssVars) colorList = colorList.concat(colorsFromCssVars(extracted.cssVars));
  if (colorList.length) {
    newFields.colors = buildColors(colorList);
    // Internal tally only — never written into config.json as a colour group.
    var vizSkipped = newFields.colors._vizSkipped || 0;
    delete newFields.colors._vizSkipped;
    var swatchCount = newFields.colors.brand.items.length +
      newFields.colors.neutrals.items.length +
      newFields.colors.semantic.items.length;
    summary.push('    Colors: ' + swatchCount + ' swatch(es) extracted' +
      (vizSkipped ? ' (' + vizSkipped + ' data-viz token(s) kept in the theme, ' +
                    'not shown as brand swatches)' : ''));
  }

  // Nothing extractable for colours or fonts → the scaffold must not stand in.
  if (!colorList.length) {
    clearIfScaffold('colors', {
      brand: { label: 'Brand', items: [] },
      neutrals: { label: 'Neutrals', items: [] },
      semantic: { label: 'Semantic', items: [] }
    }, 'colors (nothing extractable)');
  }

  // Theme from CSS variables, else synthesised from the extracted palette.
  if (extracted.cssVars) {
    newFields.theme = extractCSS.mapToTheme(extracted.cssVars, {
      warn: function (msg) { summary.push('    Warning: ' + msg); }
    });
    ensureThemeDefaults(newFields.theme);
  } else if (newFields.colors) {
    var synthesised = themeFromColors(newFields.colors);
    if (synthesised) {
      newFields.theme = synthesised;
      ensureThemeDefaults(newFields.theme);
      summary.push('    Theme: ' + Object.keys(synthesised).length +
        ' token(s) derived from the extracted palette (no CSS custom properties found)');
    }
  }

  // Nothing yielded a theme and the existing one is still brandkit's. Keeping
  // it would publish brandkit's palette as this brand's — the exact failure
  // this release removes — so it is cleared and `build` will block on it.
  if (!newFields.theme) {
    clearIfScaffold('theme', {}, 'theme (nothing extractable)');
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
          inferred: cssFonts[slot].inferred,
          source: cssFonts[slot].source
        };
      }
    });

    var fonts = {};
    var fontNotes = [];
    var unresolvedImports = [];
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
        // Never invent a Google Fonts request. `family + ':wght@300;…'` emitted
        // a live URL for any family at all — including "Nexa-bold", a
        // commercial Fontfabric face that is not on Google Fonts, producing an
        // @import that 404s. The weight list made it worse: Google's css2
        // endpoint rejects weights a family does not carry, so even a real
        // Google family (Anton, Lobster — 400 only) got a dead URL.
        //
        // brandkit cannot check without a network call, and it has no
        // dependencies and makes none. So it does not guess: the import is left
        // for a human, `fallback` keeps the specimen honest in the meantime,
        // and the merge in Phase 2 preserves a hand-written import across runs.
        googleImport: '',
        // A stand-in so the specimen renders in a real face rather than
        // silently falling back to the browser default while the label claims
        // the brand typeface. fonts.*.fallback has been in the schema since
        // 1.2.2 and generate never populated it.
        fallback: slot === 'display' ? 'Georgia' : 'Helvetica Neue',
        description: picked.inferred
          ? '__TODO: Family name inferred from the CSS variable ' + picked.source +
            ' — the variable names the binding, not necessarily the typeface. ' +
            'Confirm the real family and set googleImport before publishing.'
          : '__TODO: Describe the ' + slot + ' font.'
      };
      unresolvedImports.push(slot + ' (' + picked.family + ')');
      fontNotes.push(slot + ' = ' + picked.family +
        ' (' + picked.from + (picked.inferred ? ', inferred — needs confirming' : '') + ')');
    });
    if (Object.keys(fonts).length) {
      newFields.fonts = fonts;
      summary.push('    Fonts: ' + fontNotes.join(', '));
      if (unresolvedImports.length) {
        summary.push('    Fonts: no webfont import emitted for ' + unresolvedImports.join(', ') +
          ' — set googleImport (or a @font-face) by hand; a fallback is in place meanwhile');
      }
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

  // `newFields.fonts` is also set by the --from ingest block above, from
  // measured computed styles. Ignoring it meant a font proven to render (Trade
  // Gothic, observed on 53 elements) was overwritten with a __TODO marker, and
  // the measurement survived only in ingest-evidence.json.
  if (!extracted.tailwindFonts && !cssFonts && !newFields.fonts) {
    clearIfScaffold('fonts', {
      display: { family: '__TODO: Display typeface.', googleImport: '', description: '__TODO: Describe the display font.' },
      body: { family: '__TODO: Body typeface.', googleImport: '', description: '__TODO: Describe the body font.' }
    }, 'fonts (nothing extractable)');
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
  if (theme && needsRegeneration(baseConfig.gradients, 'gradients')) {
    var gradients = helpers.buildGradientsFromTheme(theme);
    if (gradients.length) {
      newFields.gradients = gradients;
      summary.push('    Gradients: ' + gradients.length + ' auto-generated from theme');
    } else if (documentsAnotherBrand) {
      // Nothing derivable and the field still holds brandkit's own indigo →
      // violet gradient, labelled "Brand". Leaving it because the builder
      // found nothing is how a navy steel fabricator's guide ended up
      // presenting a purple gradient as its brand. Most projects have no
      // gradient at all; none is the honest answer.
      newFields.gradients = [];
      summary.push('    Gradients: none found in this project — brandkit\'s placeholder removed');
    }
  }

  // Auto-generate hierarchy from theme
  if (theme && needsRegeneration(baseConfig.hierarchy, 'hierarchy')) {
    newFields.hierarchy = helpers.buildHierarchyFromTheme(theme);
    summary.push('    Hierarchy: 4 levels auto-generated from theme colors');
  }

  // Auto-generate accessibility pairs from all extracted colors
  if (needsRegeneration(baseConfig.accessibility, 'accessibility')) {
    var allColors = [];
    var colorSource = newFields.colors || baseConfig.colors;
    if (colorSource) {
      ['brand', 'neutrals', 'semantic'].forEach(function (key) {
        var group = colorSource[key];
        if (group) {
          var items = group.items || group;
          if (Array.isArray(items)) {
            // Carry the group so the pair generator can tell a text colour
            // from a surface tone.
            allColors = allColors.concat(items.map(function (it) {
              var copy = {};
              Object.keys(it).forEach(function (k) { copy[k] = it[k]; });
              copy.group = key;
              return copy;
            }));
          }
        }
      });
    }
    // Pair against the brand's OWN surfaces. Hard-coding white documented a
    // background a dark brand never uses.
    var surfaces = [];
    function addSurface(token, label) {
      var v = theme && theme[token];
      if (!v) return;
      var parsed = helpers.parseCssColor(v);
      if (!parsed) return;
      if (surfaces.some(function (s) { return s.hex === parsed.hex; })) return;
      surfaces.push({ hex: parsed.hex, name: label });
    }
    addSurface('--white', 'White');
    addSurface('--cloud', 'Page background');
    addSurface('--ink', 'Ink');

    if (allColors.length) {
      var a11y = helpers.generateA11yPairs(allColors, { surfaces: surfaces });
      if (a11y.length) {
        newFields.accessibility = a11y;
        var failing = a11y.filter(function (x) { return !x.passes; }).length;
        // The real count. `surfaces.length || 1` reported "1 surface" when zero
        // were found, hiding that every row was measured against an assumed
        // white the brand may never use.
        summary.push('    Accessibility: ' + a11y.length + ' pair(s) computed against ' +
          surfaces.length + ' surface(s)' +
          (failing ? ', ' + failing + ' below AA' : ''));
      } else if (!surfaces.length) {
        newFields.accessibility = [];
        summary.push('    Accessibility: no brand surface found to measure against — table left empty');
      } else {
        // The derive path used to end here with no else, so a palette that
        // produced no pairs left brandkit's scaffold table standing — the fix
        // silently doing nothing. An empty table is honest; a borrowed one is not.
        newFields.accessibility = [];
        summary.push('    Accessibility: no measurable pairs — table left empty');
      }
    } else if (documentsAnotherBrand) {
      newFields.accessibility = [];
      summary.push('    Accessibility: no colors to measure — table left empty');
    }
  }

  // Prose brandkit wrote about itself. None of it is derivable from a codebase,
  // so it becomes explicitly unfilled rather than shipping as the client's own
  // words. Phase 0 keeps markers out of the rendered guide and the exports.
  if (documentsAnotherBrand) {
    if (isStillScaffold(baseConfig.voice, scaffold.voice)) {
      newFields.voice = {
        description: '__TODO: How does this brand sound? One or two sentences.',
        do: [],
        dont: []
      };
      stripped.push('voice');
    }
    if (isStillScaffold(baseConfig.gradientUsage, scaffold.gradientUsage)) {
      newFields.gradientUsage = { do: [], dont: [] };
      stripped.push('gradientUsage');
    }
    if (isStillScaffold(baseConfig.sections, scaffold.sections)) {
      // Section intros are brandkit describing brandkit ("One config, every
      // token."). An empty intro renders as no intro, which is honest.
      newFields.sections = {};
      stripped.push('sections');
    }
    if (isStillScaffold(baseConfig.components, scaffold.components)) {
      // Cards and stats are brandkit's own marketing copy. The component
      // PATTERNS still render from the theme; only the words are removed.
      newFields.components = Object.assign({}, baseConfig.components || {}, {
        cards: [],
        stats: []
      });
      stripped.push('components');
    }
    // brandkit's own marks are not the client's logo. init copies them as
    // placeholders; listing them as this brand's assets is the same lie as
    // shipping brandkit's tagline.
    if (isStillScaffold(baseConfig.logos, scaffold.logos) && !extracted.logos) {
      newFields.logos = [];
      stripped.push('logos');
    }
  }

  // Auto-generate cssVariables from theme
  if (theme && needsRegeneration(baseConfig.cssVariables, 'cssVariables')) {
    var cssVarSections = helpers.buildCssVariablesFromTheme(theme);
    if (cssVarSections.length) {
      newFields.cssVariables = cssVarSections;
      summary.push('    CSS Variables: ' + cssVarSections.length + ' sections auto-generated');
    }
  }

  // Auto-scaffold typography if empty or missing
  if (needsRegeneration(baseConfig.typography, 'typography')) {
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

  // Read the prose-loss flags BEFORE anything deletes them. The backup guard
  // used to consult them after the reporting block had already removed them, so
  // `proseLost` was always false and a run whose only destructive change was
  // dropping an authored swatch's writing wrote no backup at all.
  var carriedByValue = (finalConfig.colors && finalConfig.colors._carriedByValue) || null;
  var ambiguousColours = (finalConfig.colors && finalConfig.colors._ambiguousColours) || null;
  var unmatchedAuthored = (finalConfig.colors && finalConfig.colors._unmatchedAuthored) || null;
  if (finalConfig.colors) {
    delete finalConfig.colors._carriedByValue;
    delete finalConfig.colors._ambiguousColours;
    delete finalConfig.colors._unmatchedAuthored;
  }
  var proseLost = !!(unmatchedAuthored || ambiguousColours);

  // Removing content is not reversible from the CLI, so leave an undo behind.
  // Written once, only when this run actually changes something and no backup
  // exists yet: overwriting it every run meant a later no-op replaced the backup
  // with a copy of the stripped config, destroying the undo for the run that did
  // the removing. Zero dependencies; a plain copy is enough.
  var backupPath = configPath + '.bak';
  var wroteBackup = false;
  if (existingConfig && (stripped.length || rederived.length || proseLost) &&
      !fs.existsSync(backupPath)) {
    var before = JSON.stringify(existingConfig, null, 2) + '\n';
    var after = JSON.stringify(finalConfig, null, 2) + '\n';
    if (before !== after) {
      try {
        fs.writeFileSync(backupPath, before);
        wroteBackup = true;
      } catch (_) { /* a failed backup must not block the write */ }
    }
  }

  // Reported after the backup decision, so the recovery advice can name a file
  // that actually exists. It used to read `wroteBackup` before assignment and
  // therefore always claimed none had been written.
  if (carriedByValue) {
    console.log('    Carried ' + carriedByValue.length +
      ' swatch name(s) across by colour value (this config predates sourceVar): ' +
      carriedByValue.join(', '));
  }
  if (ambiguousColours) {
    console.log('    Several authored swatches share one colour, so their prose ' +
      'could not be matched: ' + ambiguousColours.join(', '));
  }
  if (unmatchedAuthored) {
    // Loud, because this is authored work that could not be carried forward.
    console.log('    Could NOT carry forward prose for: ' + unmatchedAuthored.join(', '));
    console.log(wroteBackup
      ? '      recover it from config.json.bak'
      : '      recover it from version control (no new backup was written)');
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
  var todoPaths = unfilled.findTodos(finalConfig);

  console.log('');
  console.log('  Generated ' + path.relative(process.cwd(), configPath));
  if (extracted.tailwindColors) console.log('    Colors: ' + extracted.tailwindColors.length + ' extracted (with oklch)');
  if (extracted.tailwindFonts) console.log('    Fonts: ' + Object.keys(extracted.tailwindFonts).length + ' detected');
  if (extracted.tailwindSpacing) console.log('    Spacing: ' + extracted.tailwindSpacing.length + ' tokens');
  if (extracted.logos) console.log('    Logos: ' + extracted.logos.length + ' files found');
  function uniq(list) {
    return list.filter(function (v, i) { return list.indexOf(v) === i; });
  }
  if (rederived.length) {
    console.log('    Recomputed from this project (replacing brandkit\'s scaffold): ' +
      uniq(rederived).join(', '));
  }
  if (stripped.length) {
    console.log('    Removed brandkit scaffold content — not derivable, needs a human:');
    uniq(stripped).forEach(function (k) { console.log('      ' + k); });
    // Claimed only when a file was actually written. The message used to print
    // unconditionally, citing a config.json.bak that did not exist on a first
    // run (there was no previous config to back up).
    if (wroteBackup) console.log('      previous config saved to config.json.bak');
  }
  reportTodos(todoPaths);
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
  // A foreground that cannot be read on its fill is worse than none: brand.md
  // renders it as "put `X` text/icons on it", so an illegible pair becomes
  // published advice. Drop it and let the contrast-maximizing default below
  // choose. 4.5:1 is the bar because this colour is advised for TEXT — 3:1
  // would let a 3.5:1 pair through and print it as "AA Large".
  if (theme['--accent'] && theme['--accent-foreground']) {
    var pairRatio = helpers.contrastRatio(theme['--accent-foreground'], theme['--accent']);
    var measured = pairRatio === null ? null : parseFloat(pairRatio);
    // `parseFloat(null) || 0` read an UNMEASURABLE pair as 0 — below the bar —
    // so an authored token brandkit simply could not parse (a color-mix(), an
    // unresolved var()) was deleted and the block below invented #FFFFFF in its
    // place. Publishing a colour the product never declared is the exact
    // failure this release exists to remove. Only a pair that was actually
    // measured, and actually failed, is dropped.
    if (theme['--accent-foreground'] === theme['--accent'] ||
        (measured !== null && measured < 4.5)) {
      delete theme['--accent-foreground'];
    }
  }
  if (theme['--accent'] && !theme['--accent-foreground'] && helpers.parseCssColor(theme['--accent'])) {
    // Pick the on-fill color with the higher WCAG contrast (not a luminance
    // threshold — a mid-tone fill like orange reads better with black text
    // even though it isn't "light").
    var lum = helpers.relativeLuminance(theme['--accent']);
    var contrastWhite = 1.05 / (lum + 0.05);
    var contrastBlack = (lum + 0.05) / 0.05;
    theme['--accent-foreground'] = contrastBlack >= contrastWhite ? '#000000' : '#FFFFFF';
  }
  // --accent-text is the accent used AS text on a light surface. Copying the
  // fill verbatim published a caution-grade pair as guidance — a mid-tone
  // accent reads at 1.3:1 on white. Darken until it clears AA, and emit
  // nothing if it never does rather than advising an unreadable colour.
  if (theme['--accent'] && !theme['--accent-text']) {
    var onPaper = theme['--white'] || '#FFFFFF';
    var accentHex = helpers.parseCssColor(theme['--accent']);
    if (accentHex) {
      var readable = ingest.darkenUntilReadable(accentHex.hex, onPaper, 4.5);
      if (readable) theme['--accent-text'] = readable;
    }
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
    // sourceVar is the stable identity: the token this colour came from.
    // cssVar is derived from the human name, so keying a merge on it means a
    // rename orphans the very prose the merge exists to preserve.
    out.push({ name: humanizeVarName(key), hex: cssVars[key], role: '', sourceVar: key });
  });
  return out;
}

/**
 * A theme from an extracted palette, for a host with no CSS custom properties.
 *
 * `theme` was only ever built from cssVars, so a Tailwind-3 project — colours
 * in a JS config, no `:root` block — kept brandkit's entire 26-key scaffold
 * palette. `brand.md` then told the client their accent was #4F46E5,
 * `tokens.json` carried 20 brandkit colours, and gradients/hierarchy were
 * derived FROM that scaffold and reported as "recomputed from this project".
 * None of it carried a marker, so nothing objected.
 */
function themeFromColors(colors) {
  if (!colors) return null;
  var theme = {};

  function firstOf(group) {
    var items = (colors[group] && colors[group].items) || [];
    return items.length ? items[0] : null;
  }
  // Whole words, and an exact name beats a word inside a longer one. A plain
  // substring scan let a swatch called "Greenhouse" claim `--success` ahead of
  // the swatch actually named "Success".
  function bySemanticName(names) {
    var items = (colors.semantic && colors.semantic.items) || [];
    var exact = null;
    var worded = null;
    items.forEach(function (item) {
      if (!helpers.parseCssColor(item.hex)) return;
      var n = String(item.name || '').toLowerCase().trim();
      var words = n.split(/[^a-z0-9]+/).filter(Boolean);
      names.forEach(function (want) {
        if (!exact && n === want) exact = item;
        if (!worded && words.indexOf(want) !== -1) worded = item;
      });
    });
    return exact || worded;
  }

  // The accent gets the same parse guard as the neutrals below. Checking only
  // truthiness wrote an undeterminable value — a swatch whose hex is still
  // `var(--brand)` — into theme, where it was published as this brand's accent.
  var accent = firstOf('brand');
  if (accent && helpers.parseCssColor(accent.hex)) theme['--accent'] = accent.hex;

  // Neutrals sorted by luminance give the ink/paper ends of the ramp.
  var neutrals = ((colors.neutrals && colors.neutrals.items) || []).filter(function (n) {
    return n.hex && helpers.relativeLuminance(n.hex) !== null;
  }).sort(function (a, b) {
    return helpers.relativeLuminance(a.hex) - helpers.relativeLuminance(b.hex);
  });
  if (neutrals.length) {
    theme['--ink'] = neutrals[0].hex;
    theme['--cloud'] = neutrals[neutrals.length - 1].hex;
    if (neutrals.length > 2) theme['--slate'] = neutrals[Math.floor(neutrals.length / 2)].hex;
  }

  [['--success', ['success', 'green', 'positive']],
   ['--warning', ['warning', 'caution', 'amber']],
   ['--error', ['error', 'danger', 'destructive', 'red']]].forEach(function (pair) {
    var hit = bySemanticName(pair[1]);
    if (hit && hit.hex) theme[pair[0]] = hit.hex;
  });

  return Object.keys(theme).length ? theme : null;
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

  // Data-viz colours belong to the design system but are not brand identity,
  // and there is no swatch group for them. Listing chart-4 as a brand colour
  // misrepresents the palette; they stay in `theme` and the CSS-variable
  // reference, which is where a developer looks for them.
  var VIZ_RE = /\b(chart|graph|viz|series|dataviz)\b|^chart[- ]?\d/i;
  var vizSkipped = 0;

  for (var i = 0; i < colorList.length; i++) {
    var c = colorList[i];
    if (!c.name) continue;
    if (VIZ_RE.test(c.name)) { vizSkipped++; continue; }
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
    // Origin of this swatch, for a stable per-item merge on re-generate.
    entry.sourceVar = c.sourceVar || ('name:' + lowerName);

    if (isSemantic) semantic.push(entry);
    else if (isNeutral) neutrals.push(entry);
    else brand.push(entry);
  }

  return {
    brand: { label: 'Brand', items: brand },
    neutrals: { label: 'Neutrals', items: neutrals },
    semantic: { label: 'Semantic', items: semantic },
    _vizSkipped: vizSkipped
  };
}

/**
 * Report the gaps grouped by section. A bare integer stops being actionable
 * past a handful of items; the section tells you where to go.
 */
function reportTodos(paths) {
  if (!paths.length) return;
  var groups = {};
  paths.forEach(function (p) {
    var section = unfilled.sectionOf(p);
    (groups[section] = groups[section] || []).push(p);
  });
  console.log('    Not yet defined — ' + paths.length + ' item(s):');
  Object.keys(groups).sort().forEach(function (section) {
    var blocks = groups[section].some(unfilled.isBlocking);
    console.log('      ' + section + ' (' + groups[section].length + ')' +
      (blocks ? '  — needed before this guide is client-ready' : ''));
  });
}

/**
 * Is this field still exactly what brandkit scaffolded?
 *
 * `isEmptyOrScaffold` only ever looked for `__TODO`, but the starter ships
 * populated, marker-free content — so the check was always false and twelve
 * sections were never regenerated. A client's guide therefore showed brandkit's
 * indigo gradient labelled "Brand", brandkit's voice ("Brandkit speaks like a
 * thoughtful teammate"), and cards reading "One config — A single config.json
 * drives every colour…". Nothing flagged it, because none of it is a marker.
 *
 * Compared per item where the field is a list: editing one of six accessibility
 * rows must not make the other five count as the author's work.
 */
function isStillScaffold(value, scaffoldValue) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value) && Array.isArray(scaffoldValue)) {
    // Per item, and NOT a subset test. A subset test got both directions
    // wrong: deleting one scaffold row left the rest a subset, so the array
    // read as untouched and the deletion was undone on the next run; while
    // editing one row made the whole array "authored" and left the other five
    // brandkit rows standing. Scaffold only when nothing the author put there
    // survives.
    return authoredItems(value, scaffoldValue).length === 0;
  }
  return JSON.stringify(value) === JSON.stringify(scaffoldValue);
}

/** The entries in `value` that did not come from the scaffold. */
function authoredItems(value, scaffoldValue) {
  if (!Array.isArray(value)) return [];
  var scaffoldSet = {};
  (scaffoldValue || []).forEach(function (v) { scaffoldSet[JSON.stringify(v)] = true; });
  return value.filter(function (v) { return scaffoldSet[JSON.stringify(v)] !== true; });
}

/**
 * Is this field absent, empty, or holding an unfilled marker?
 *
 * Named for what it once did. The scaffold half of the question now lives in
 * isStillScaffold() — this only answers "is there nothing usable here", which
 * is why a populated, marker-free starter section sailed past it for twelve
 * fields.
 */
function isEmptyOrScaffold(value) {
  if (!value) return true;
  if (Array.isArray(value) && value.length === 0) return true;
  // Check if all entries are scaffold (contain __TODO)
  var str = JSON.stringify(value);
  if (str.indexOf('__TODO') !== -1) return true;
  return false;
}
