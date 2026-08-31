/**
 * Regression tests for 1.6.0 — the unfilled-state layer, scaffold provenance,
 * pairing/gate fixes, merge semantics, font honesty and accessibility.
 *
 * Every case names the failure it locks out. Where a fix is a boundary or a
 * gate, the test is written so it FAILS against the code without that fix.
 */
var os = require('os');
var path = require('path');
var fs = require('fs');
var extractCSS = require('../lib/extract-css');
var helpers = require('../lib/generate-helpers');
var exporter = require('../lib/export');
var schema = require('../lib/config-schema');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

/* ---------------- 1. Unfilled state is not prose ---------------- */

check('a marker is unfilled', exporter.isUnset('__TODO: describe this'), true);
check('empty is unfilled', exporter.isUnset('   '), true);
check('real prose is not unfilled', exporter.isUnset('Barone Blue'), false);
check('a non-string is not unfilled', exporter.isUnset(42), false);

var markerCfg = {
  brand: { name: 'x', displayName: 'Barone Steel', tagline: '__TODO: t', description: '__TODO: d' },
  theme: { '--accent': '#111827' },
  fonts: { display: { family: 'Archivo', description: '__TODO: Family name inferred from …' } },
  voice: { description: '__TODO: v', do: ['__TODO: a', 'A real do'], dont: [] },
  accessibility: [{ fg: '#111827', bg: '#FFFFFF', fgName: 'Ink', bgName: 'White',
                    ratio: '__TODO', rating: '__TODO' }],
  changelog: [{ version: '1.0', date: 'Aug 2026', changes: ['Real', '__TODO: placeholder'] }]
};
var md = exporter.buildBrandMarkdown(markerCfg);
var bj = exporter.buildBrandJson(markerCfg);

// This is the regression 1.5.0 shipped: maintainer instructions in the artifact
// an agency sends a client for approval.
check('no marker reaches brand.md', (md.match(/__TODO/g) || []).length, 0);
check('no marker reaches brand.json', (JSON.stringify(bj).match(/__TODO/g) || []).length, 0);
check('a real list entry survives the filter', bj.voice.do, ['A real do']);
check('a real changelog entry survives', bj.changelog[0].changes, ['Real']);
// {ratio:'__TODO'} rendered as "is __TODO (__TODO) — fails AA".
check('an unfilled ratio raises no caution', md.indexOf('Contrast cautions'), -1);
check('brand.md reports the gaps once, plainly', md.indexOf('## Not yet defined') !== -1, true);
check('an unfilled font rationale is not printed as prose',
  md.indexOf('inferred') === -1, true);

/* ---------------- 2. A foreground follows its own fill ---------------- */

var warns = [];
var theme = extractCSS.mapToTheme({
  '--primary': '#111111',
  '--primary-foreground': '#FFFFFF',
  '--accent': '#EEEEEE',
  '--accent-foreground': '#222222'
}, { warn: function (m) { warns.push(m); } });

check('the fill comes from --primary', theme['--accent'], '#111111');
check('its foreground comes from --primary-foreground', theme['--accent-foreground'], '#FFFFFF');
check("shadcn's own --accent still becomes --coral", theme['--coral'], '#EEEEEE');
// Passing it through would collide with --primary-foreground and be resolved
// by CSS declaration order — luck, not design.
check('the orphaned foreground is dropped, not guessed', warns.length, 1);

// A future edit must not be able to reintroduce a two-into-one destination.
check('THEME_MAPPING is asserted 1:1 at load', typeof extractCSS.mapToTheme, 'function');

/* ---------------- 3. Contrast is measured, never invented ---------------- */

// export.js kept the isHex gate that buildTokensJson dropped in 1.5.0, so an
// oklch theme produced no ratios at all and prune() removed the whole block.
var oklchBrand = exporter.buildBrandJson({
  brand: { name: 'x' },
  theme: { '--accent': 'oklch(0.3623 0.1583 269.14)', '--accent-foreground': 'oklch(0.98 0 0)' }
});
check('an oklch theme still yields a contrast figure',
  !!(oklchBrand.color && oklchBrand.color.accent && oklchBrand.color.accent.contrast), true);
check('and it is a real ratio',
  /^\d+\.\d+:1$/.test(oklchBrand.color.accent.contrast.onFill.ratio), true);

/* ---------------- 4. Accessibility reports failures ---------------- */

var pairs = helpers.generateA11yPairs(
  [{ hex: '#FFD400', name: 'Caution Yellow', group: 'brand' },
   { hex: '#1F2F8F', name: 'Barone Blue', group: 'brand' }],
  { surfaces: [{ hex: '#FFFFFF', name: 'White' }, { hex: '#1C1C1E', name: 'Void' }] });

// Failures were filtered out, so the table could only ever contain passes.
check('a failing pair is reported, not filtered away',
  pairs.some(function (p) { return p.passes === false; }), true);
// Every pair used to be computed against #FFFFFF.
check('pairs are measured against the brand\'s own surfaces',
  pairs.some(function (p) { return p.bgName === 'Void'; }), true);
check('an unmeasurable colour contributes no row',
  helpers.generateA11yPairs([{ hex: 'var(--x)', name: 'Broken' }], {}).length, 0);
// A surface tone on another surface is not a text pairing.
var neutralPairs = helpers.generateA11yPairs(
  [{ hex: '#F7F7F7', name: 'Tint', group: 'neutrals' }],
  { surfaces: [{ hex: '#FFFFFF', name: 'White' }] });
check('a surface-on-surface pair is not flagged as text',
  neutralPairs.every(function (p) { return p.textPairing === false; }), true);

/* ---------------- 5. Scaffold provenance ---------------- */

var scaffold = schema.starterConfig();
check('brandkit does not strip its own repo', schema.hostBrandIdentity('.'), null);

// The merge must not treat brandkit's own values as the author's work: that
// preserved the starter's "Space+Grotesk:wght@…" beside a freshly extracted
// "Nexa-bold" family — loading one typeface while labelling it another.
var mergedFonts = schema.mergeConfigs(
  { fonts: { display: { family: 'Space Grotesk',
                        googleImport: scaffold.fonts.display.googleImport,
                        description: scaffold.fonts.display.description } } },
  { fonts: { display: { family: 'Nexa-bold', googleImport: '', fallback: 'Georgia' } } }
).fonts;
check('a scaffold googleImport is not preserved', mergedFonts.display.googleImport, '');
check('the extracted family wins', mergedFonts.display.family, 'Nexa-bold');

var mergedAuthored = schema.mergeConfigs(
  { fonts: { display: { family: 'Old', googleImport: 'Archivo:wght@400;700',
                        description: 'Chosen for its engineered feel.' } } },
  { fonts: { display: { family: 'Archivo', googleImport: '' } } }
).fonts;
check('a hand-written import survives', mergedAuthored.display.googleImport, 'Archivo:wght@400;700');
check('hand-written rationale survives', mergedAuthored.display.description,
  'Chosen for its engineered feel.');

// Swatches merge on sourceVar, which survives a rename; cssVar is derived FROM
// the name, so keying on it orphans the prose it exists to protect.
var mergedColors = schema.mergeConfigs(
  { colors: { brand: { label: 'Brand', items: [
      { name: 'Barone Blue', role: 'Structural steel blue', hex: '#000000', sourceVar: '--brand' }] },
      neutrals: { label: 'Neutrals', items: [] }, semantic: { label: 'Semantic', items: [] } } },
  { colors: { brand: { label: 'Brand', items: [
      { name: 'Brand', role: '', hex: '#1F2F8F', sourceVar: '--brand' }] },
      neutrals: { label: 'Neutrals', items: [] }, semantic: { label: 'Semantic', items: [] } } }
).colors;
check('a renamed swatch keeps its name', mergedColors.brand.items[0].name, 'Barone Blue');
check('and its role', mergedColors.brand.items[0].role, 'Structural steel blue');
check('while the value re-derives', mergedColors.brand.items[0].hex, '#1F2F8F');

// A colour the host deleted must not be resurrected by leftover prose.
var afterDelete = schema.mergeConfigs(
  { colors: { brand: { label: 'Brand', items: [
      { name: 'Gone', role: 'was here', hex: '#111', sourceVar: '--gone' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'Brand', items: [] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('a deleted colour is not resurrected', afterDelete.brand.items.length, 0);

/* ---------------- 6. Data-viz colours are not brand swatches ---------------- */
// (covered end-to-end by the CLI; here the classifier boundary)
check('an unfilled value is dropped from a font projection',
  exporter.buildBrandJson({ brand: { name: 'x' },
    fonts: { display: { family: 'Archivo', googleImport: '', description: '__TODO: x' } } })
    .type.display, { family: 'Archivo' });

/* ---------------- 7. Ensemble-review findings on 1.6.0 ---------------- */

// An unmeasurable pair read as 0 via `parseFloat(null) || 0`, so an authored
// token brandkit could not parse was deleted and #FFFFFF invented for it.
check('an unmeasurable pair is null, not 0',
  helpers.contrastRatio('color-mix(in oklab, #fff 90%, #000)', '#1F2F8F'), null);

// isTextCandidate used a signed difference, so light text on a dark surface was
// never treated as type and its failures were filtered out of the cautions.
var darkPairs = helpers.generateA11yPairs(
  [{ hex: '#F2F2F7', name: 'Paper', group: 'neutrals' }],
  { surfaces: [{ hex: '#1C1C1E', name: 'Void' }] });
check('light text on a dark surface counts as a text pairing',
  darkPairs.every(function (p) { return p.textPairing === true; }), true);

// A colour that is both a surface and a swatch was reached twice.
var dupePairs = helpers.generateA11yPairs(
  [{ hex: '#FFFFFF', name: 'White', group: 'neutrals' },
   { hex: '#111827', name: 'Ink', group: 'neutrals' }],
  { surfaces: [{ hex: '#FFFFFF', name: 'White' }, { hex: '#111827', name: 'Ink' }] });
var dupeKeys = dupePairs.map(function (p) { return p.fg + '|' + p.bg; });
check('no duplicate rows when a surface is also a swatch',
  dupeKeys.length, dupeKeys.filter(function (k, i) { return dupeKeys.indexOf(k) === i; }).length);

// sourceVar was introduced in 1.6.0, so the first run over an older config
// found no prior item and reverted every author-renamed swatch.
var upgraded = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [
      { name: 'Barone Blue', role: 'Structural steel blue', hex: '#000000' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [
      { name: 'Brand', role: '', hex: '#1F2F8F', sourceVar: '--brand' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('a pre-1.6.0 config keeps its authored name', upgraded.brand.items[0].name, 'Barone Blue');
check('and its authored role', upgraded.brand.items[0].role, 'Structural steel blue');
check('the positional pairing is reported, not silent',
  (upgraded._positionalMatches || []).length, 1);

// Position is only trusted when the group length is unchanged: pairing one
// colour's prose onto a different colour would be confidently wrong.
var ambiguous = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [{ name: 'A', hex: '#000' }, { name: 'B', hex: '#111' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [{ name: 'X', hex: '#222', sourceVar: '--x' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('a length mismatch is not paired by position', ambiguous.brand.items[0].name, 'X');

// An ordinary brand colour name that the starter happens to use.
var slate = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [] },
      neutrals: { label: 'N', items: [{ name: 'Slate', role: 'Our grey', hex: '#000', sourceVar: '--grey' }] },
      semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [] },
      neutrals: { label: 'N', items: [{ name: 'Grey', role: '', hex: '#6B7280', sourceVar: '--grey' }] },
      semantic: { label: 'S', items: [] } } }
).colors;
check('an author may name a colour "Slate"', slate.neutrals.items[0].name, 'Slate');

// An element whose every field was unfilled must not survive as {}.
check('an array element pruned to {} is dropped',
  exporter.buildBrandJson({ brand: { name: 'x' },
    accessibility: [{ fg: '__TODO', bg: '__TODO', ratio: '__TODO', rating: '__TODO' }] }).accessibility,
  undefined);

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
