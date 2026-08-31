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
var unfilled = require('../lib/unfilled');

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

// sourceVar was introduced in 1.6.0, so the first run over an older config has
// no provenance key. The bridge is the COLOUR VALUE, which identifies the same
// swatch regardless of order, count, or what it was renamed to.
var upgraded = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [
      { name: 'Barone Blue', role: 'Structural steel blue', hex: '#1F2F8F' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [
      { name: 'Brand', role: '', hex: '#1F2F8F', sourceVar: '--brand' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('a pre-1.6.0 config keeps its authored name', upgraded.brand.items[0].name, 'Barone Blue');
check('and its authored role', upgraded.brand.items[0].role, 'Structural steel blue');
check('the value-based pairing is reported', (upgraded._carriedByValue || []).length, 1);

// Position must NEVER be used. Config order is not the host's declaration
// order, so pairing by index swapped two swatches' names AND roles onto each
// other — and the viz-token skip changed the extracted count, disabling the
// length guard on exactly the shadcn projects that ship --chart-1..5.
var swapped = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [
      { name: 'Barone Blue', role: 'The corporate navy', hex: '#0A2A5E' },
      { name: 'Safety Orange', role: 'Accent only', hex: '#F97316' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [
      { name: 'Sunburst', role: '', hex: '#F97316', sourceVar: '--sunburst' },
      { name: 'Barone Navy', role: '', hex: '#0A2A5E', sourceVar: '--barone-navy' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('prose follows the colour, not the index',
  swapped.brand.items.map(function (i) { return i.hex + '=' + i.name; }),
  ['#F97316=Safety Orange', '#0A2A5E=Barone Blue']);
check('and so does the role', swapped.brand.items[0].role, 'Accent only');

// When the value ALSO changed there is no honest bridge. The prose is not
// guessed onto another swatch — the loss is reported instead.
var lostProse = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [
      { name: 'Barone Blue', role: 'Structural steel blue', hex: '#000000' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } },
  { colors: { brand: { label: 'B', items: [
      { name: 'Brand', role: '', hex: '#1F2F8F', sourceVar: '--brand' }] },
      neutrals: { label: 'N', items: [] }, semantic: { label: 'S', items: [] } } }
).colors;
check('an unbridgeable rename is not guessed', lostProse.brand.items[0].name, 'Brand');
check('and the loss is reported, not silent',
  (lostProse._unmatchedAuthored || []).indexOf('Barone Blue') !== -1, true);

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

/* ---------------- 8. Team-review findings on 1.6.0 ---------------- */

// Provenance must fail CLOSED. Keyed on `hostBrandIdentity() !== null` it failed
// OPEN: no package.json meant no stripping, and brandkit's voice and tagline
// shipped to the client with `build` reporting "Ready to deploy".
check('brandkit recognises its own repo', schema.isBrandkitRepo('.'), true);
var noPkg = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-nopkg-'));
check('a project with no package.json is NOT brandkit', schema.isBrandkitRepo(noPkg), false);
fs.writeFileSync(path.join(noPkg, 'package.json'), '{}');
check('a package.json with no name is NOT brandkit', schema.isBrandkitRepo(noPkg), false);
try { fs.rmSync(noPkg, { recursive: true, force: true }); } catch (_) { /* gone */ }

// The a11y table assumed #FFFFFF when no surface was supplied, fabricating a
// failure against a background a dark brand never uses.
check('no surfaces means no table',
  helpers.generateA11yPairs([{ hex: '#F5F5F7', name: 'Text', group: 'neutrals' }], {}).length, 0);
check('a real surface still measures',
  helpers.generateA11yPairs([{ hex: '#F5F5F7', name: 'Text', group: 'neutrals' }],
    { surfaces: [{ hex: '#1C1C1E', name: 'Surface' }] }).length > 0, true);

// A colour group with a label and no swatches is empty, not content.
check('a labelled but empty colour group is blank',
  unfilled.isBlank({ brand: { label: 'Brand', items: [] },
                     neutrals: { label: 'Neutrals', items: [] },
                     semantic: { label: 'Semantic', items: [] } }), true);
check('a group with a swatch is not blank',
  unfilled.isBlank({ brand: { label: 'Brand', items: [{ name: 'Navy', hex: '#0A2A5E' }] } }), false);

// Blocking is per FIELD, not per section: a missing footer URL must not
// hard-fail a build that worked on 1.5.0.
check('a missing tagline blocks', unfilled.isBlocking('brand.tagline'), true);
check('a missing url does not', unfilled.isBlocking('brand.url'), false);
check('a missing byline does not', unfilled.isBlocking('brand.byline'), false);
check('theme is blocking', unfilled.isBlocking('theme'), true);

// Authored logo prose survives a filesystem rescan, keyed on the asset path.
var logosMerged = schema.mergeConfigs(
  { logos: [{ name: 'Barone Steel primary wordmark', description: 'Minimum width 140px.',
              variants: { svg: 'logos/wordmark.svg' } }] },
  { logos: [{ name: 'Wordmark', description: '', variants: { svg: 'logos/wordmark.svg' } }] }
).logos;
check('authored logo name survives a rescan', logosMerged[0].name, 'Barone Steel primary wordmark');
check('and its usage note', logosMerged[0].description, 'Minimum width 140px.');

// An explicit `logos: []` from provenance stripping is a decision, not an
// absence, and must not be re-merged away.
check('a deliberately empty logo list passes through',
  schema.mergeConfigs({ logos: [{ name: 'X', variants: {} }] }, { logos: [] }).logos, []);

// The table keeps meaningful rows only: a plausible text pairing, or a failure.
var trimmed = helpers.generateA11yPairs(
  [{ hex: '#FAFAFA', name: 'Paper Tint', group: 'neutrals' }],
  { surfaces: [{ hex: '#FFFFFF', name: 'White' }] });
check('a passing surface-on-surface row is trimmed',
  trimmed.every(function (p) { return p.textPairing || !p.passes; }), true);

/* ---------------- 9. Ensemble round 2 on 1.6.0 ---------------- */

function group(items, g) {
  var o = { brand: { label: 'B', items: [] }, neutrals: { label: 'N', items: [] },
            semantic: { label: 'S', items: [] } };
  o[g || 'brand'].items = items;
  return { colors: o };
}

// Prose carried across by NAME was still reported as lost — a false claim in
// the release built to stop false claims.
var named = schema.mergeConfigs(
  group([{ name: 'Navy', role: 'Our navy', hex: '#0A2A5E' }]),
  group([{ name: 'Navy', role: '', hex: '#123456', sourceVar: '--navy' }])).colors;
check('a name-matched role is preserved', named.brand.items[0].role, 'Our navy');
check('and is not reported as lost', (named._unmatchedAuthored || []).length, 0);

// Two authored swatches sharing one colour: the value cannot identify which is
// which, so neither may be guessed at.
var shared = schema.mergeConfigs(
  { colors: { brand: { label: 'B', items: [{ name: 'Barone Blue', role: 'Structural navy', hex: '#1F2F8F' }] },
      neutrals: { label: 'N', items: [] },
      semantic: { label: 'S', items: [{ name: 'Link Blue', role: 'Links only', hex: '#1F2F8F' }] } } },
  { colors: { brand: { label: 'B', items: [{ name: 'A', hex: '#1F2F8F', sourceVar: '--a' }] },
      neutrals: { label: 'N', items: [] },
      semantic: { label: 'S', items: [{ name: 'B', hex: '#1F2F8F', sourceVar: '--b' }] } } }).colors;
check('an ambiguous colour is not stamped with one swatch\'s prose',
  [shared.brand.items[0].name, shared.semantic.items[0].name], ['A', 'B']);
check('and the ambiguity is reported', (shared._ambiguousColours || []).length, 2);

// #00A and #0000AA are the same colour.
var shortHex = schema.mergeConfigs(
  group([{ name: 'Barone Blue', role: 'Structural steel blue', hex: '#00A' }]),
  group([{ name: 'Brand', role: '', hex: '#0000AA', sourceVar: '--brand' }])).colors;
check('a 3-digit hex bridges to its 6-digit form', shortHex.brand.items[0].name, 'Barone Blue');

// A scoped client package must not identify AS brandkit — that would disable
// every provenance check for it.
var scoped = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-scoped-'));
fs.writeFileSync(path.join(scoped, 'package.json'), JSON.stringify({ name: '@client/brandkit' }));
check('@client/brandkit is not brandkit', schema.isBrandkitRepo(scoped), false);
fs.writeFileSync(path.join(scoped, 'package.json'), JSON.stringify({ name: '@stacklist-app/brandkit' }));
check('the real published name is brandkit', schema.isBrandkitRepo(scoped), true);
try { fs.rmSync(scoped, { recursive: true, force: true }); } catch (_) { /* gone */ }

/* ---------------- 10. Ensemble round 3 — the multi-pass resolver ---------------- */

function C(b, n, sm) {
  return { colors: { brand: { label: 'B', items: b || [] },
                     neutrals: { label: 'N', items: n || [] },
                     semantic: { label: 'S', items: sm || [] } } };
}

// A greedy single pass let one prior supply prose to TWO swatches — claimed by
// colour, then again by name — so the guide showed two identical names.
var twice = schema.mergeConfigs(
  C([{ name: 'Barone Blue', role: 'Structural navy', hex: '#1F2F8F' }]),
  C([{ name: 'Steel', hex: '#1F2F8F', sourceVar: '--steel' },
     { name: 'Barone Blue', hex: '#22308F', sourceVar: '--barone' }])).colors;
check('a prior is never claimed twice',
  twice.brand.items[0].name === twice.brand.items[1].name, false);

// Ambiguity decided before later evidence arrived reported a swatch unmatched
// that in fact matched on a stronger pass.
var settled = schema.mergeConfigs(
  C([{ name: 'Barone Blue', role: 'Structural navy', hex: '#1F2F8F', sourceVar: '--a' },
     { name: 'Link Blue', role: 'Links only', hex: '#1F2F8F', sourceVar: '--b' }]),
  C([{ name: 'X', hex: '#1F2F8F', sourceVar: '--x' },
     { name: 'Barone Blue', hex: '#1F2F8F', sourceVar: '--a' }])).colors;
check('ambiguity a later pass resolves is not reported',
  (settled._ambiguousColours || []).length, 0);
check('and nothing is falsely reported lost', (settled._unmatchedAuthored || []).length, 0);

// A duplicate name must not beat a colour that identifies its swatch uniquely.
var unique = schema.mergeConfigs(
  C([{ name: 'Blue', role: 'Brand', hex: '#111111' }], [],
    [{ name: 'Blue', role: 'Links', hex: '#222222' }]),
  C([{ name: 'Blue', hex: '#222222', sourceVar: '--new' }])).colors;
check('a unique colour beats an ambiguous name', unique.brand.items[0].role, 'Links');

// An alpha hex is a different colour, and a malformed one is not a colour.
check('alpha is not folded onto opaque',
  schema.mergeConfigs(C([{ name: 'Half Red', role: 'overlay', hex: '#FF000080' }]),
    C([{ name: 'Red', hex: '#FF0000', sourceVar: '--red' }])).colors.brand.items[0].name, 'Red');
check('a 7-digit hex is not truncated into a match',
  schema.mergeConfigs(C([{ name: 'Typo', role: 'x', hex: '#1234567' }]),
    C([{ name: 'Real', hex: '#123456', sourceVar: '--r' }])).colors.brand.items[0].name, 'Real');

// Authored prose on an otherwise-scaffold-shaped item must not vanish silently.
var scaffoldish = JSON.parse(JSON.stringify(schema.starterConfig().colors.brand.items[0]));
scaffoldish.description = 'Client approved 2026-04-02';
check('an authored description on a scaffold-shaped item is reported if lost',
  (schema.mergeConfigs(C([scaffoldish]), C([{ name: 'Other', hex: '#ABCDEF', sourceVar: '--o' }]))
    .colors._unmatchedAuthored || []).length > 0, true);

/* ---------------- 11. Ensemble round 4 — two-sided uniqueness ---------------- */

// Provenance claims must be honest about HOW a pairing was made. Inferring
// "carried by colour value" from differing sourceVars labelled every name match
// that way — essentially every swatch in any pre-1.6.0 upgrade.
var byNameOnly = schema.mergeConfigs(
  C([{ name: 'Barone Blue', role: 'Structural navy', hex: '#1F2F8F' }]),
  C([{ name: 'Barone Blue', hex: '#22308F', sourceVar: '--barone' }])).colors;
check('a name match carries the prose', byNameOnly.brand.items[0].role, 'Structural navy');
check('and is NOT reported as carried by colour value',
  (byNameOnly._carriedByValue || []).length, 0);

// A key claims a prior only when it identifies exactly one on BOTH sides.
var dupSource = schema.mergeConfigs(
  C([{ name: 'One', role: 'first', hex: '#111111', sourceVar: '--x' },
     { name: 'Two', role: 'second', hex: '#222222', sourceVar: '--x' }]),
  C([{ name: 'Two', hex: '#222222', sourceVar: '--x' }])).colors;
check('a duplicated sourceVar does not claim by array order',
  dupSource.brand.items[0].role, 'second');

var dupTargetName = schema.mergeConfigs(
  C([{ name: 'Client Blue', role: 'Links', hex: '#222222' }]),
  C([{ name: 'Client Blue', hex: '#111111', sourceVar: '--a' },
     { name: 'Client Blue', hex: '#222222', sourceVar: '--b' }])).colors;
check('two targets sharing a name do not consume the prior',
  dupTargetName.brand.items[0].role, undefined);
check('and the one its colour identifies gets the prose',
  dupTargetName.brand.items[1].role, 'Links');

// A genuine value bridge is still labelled as one.
var byValue = schema.mergeConfigs(
  C([{ name: 'Barone Blue', role: 'Structural steel blue', hex: '#1F2F8F' }]),
  C([{ name: 'Brand', hex: '#1F2F8F', sourceVar: '--brand' }])).colors;
check('a real value bridge is reported as such',
  (byValue._carriedByValue || []).indexOf('Barone Blue') !== -1, true);

/* ---------------- 12. Ensemble round 5 ---------------- */

// Colour names come from a client's stylesheet. A bucket map on a bare {} meant
// a swatch named `__proto__` or `constructor` reached an inherited member and
// `.push` threw, aborting the entire merge.
['__proto__', 'constructor', 'toString', 'hasOwnProperty'].forEach(function (n) {
  var threw = false;
  var role;
  try {
    role = schema.mergeConfigs(
      C([{ name: n, role: 'x', hex: '#112233' }]),
      C([{ name: n, hex: '#112233', sourceVar: '--c' }])).colors.brand.items[0].role;
  } catch (_) { threw = true; }
  check('a colour named "' + n + '" does not break the merge', threw, false);
  check('  and its prose survives', role, 'x');
});

// Indeterminate in either direction. Reporting only prior-side ambiguity told
// the user a colour was "not found" when it could not be told apart — the wrong
// cause for someone deciding whether to re-approve a brand.
var oneToMany = schema.mergeConfigs(
  C([{ name: 'Brand Blue', role: 'Primary CTA', hex: '#0055FF' }]),
  C([{ name: 'Blue', hex: '#0055FF', sourceVar: '--blue' },
     { name: 'Blue Alt', hex: '#0055FF', sourceVar: '--blue-alt' }])).colors;
check('one prior shared by several targets is reported ambiguous',
  (oneToMany._ambiguousColours || []).indexOf('Brand Blue') !== -1, true);

// mergeLogos buckets on asset paths from the host filesystem. On a bare {} a
// path of `__proto__` made the lookup truthy via inheritance, so the entry was
// never recorded and the authored prose was dropped — silently, unlike the
// colour buckets which threw.
check('an asset path of "__proto__" does not lose authored logo prose',
  schema.mergeConfigs(
    { logos: [{ name: 'Real wordmark', description: 'Min 140px', variants: { svg: '__proto__' } }] },
    { logos: [{ name: 'X', variants: { svg: '__proto__' } }] }).logos[0].name,
  'Real wordmark');

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
