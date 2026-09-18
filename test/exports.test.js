/**
 * Tests for 1.7.0: exports complete enough to design from.
 *
 * The fixture is Freeway's config with its em dashes removed, because every
 * gap this release closes was found by auditing that guide's output: brand.md
 * never named Plum, Pink or Salmon; tokens.json had no Plum or Pink; nothing
 * anywhere said how to compose a canvas that is not a web page.
 */
var fs = require('fs');
var path = require('path');
var exporter = require('../lib/export');
var formatsLib = require('../lib/formats');
var schema = require('../lib/config-schema');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}
function has(text, needle) { return text.indexOf(needle) !== -1; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function fixture(name) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
}

var DASHES = /[\u2014\u2013]/;
var freeway = fixture('freeway.config.json');
var extras = fixture('freeway.formats.json');
var withFormats = clone(freeway);
withFormats.logoUsage = extras.logoUsage;
withFormats.formats = extras.formats;

/* ---------------- 1. brand.md names the whole palette ---------------- */

var md = exporter.buildBrandMarkdown(freeway);
[['Indigo', '#281D73', 'Primary.'], ['Sapphire', '#2930A6', 'Interactive.'], ['Plum', '#A65188', 'Accent.'],
 ['Pink', '#D56181', 'Accent.'], ['Salmon', '#F77D73', 'Secondary.']].forEach(function (c) {
  check('brand.md names ' + c[0] + ' with hex and role', has(md, '- **' + c[0] + '** `' + c[1] + '`: ' + c[2]), true);
});
check('the palette comes before the usage lines', md.indexOf('**Palette:**') < md.indexOf('**Accent (fill):**'), true);
check('the accent usage line is kept', has(md, '- **Accent (fill):** `#281D73`. Put `#FFFFFF` text/icons on it'), true);
check('the semantic line is kept', has(md, '- **Semantic:** success `#2D9F6F`'), true);
freeway.colors.neutrals.forEach(function (n) {
  check('brand.md lists neutral ' + n.name, has(md, '- **' + n.name + '** `' + n.hex + '`: '), true);
});
check('a color measured on white says so', has(md, '- **Plum** `#A65188`: Accent. Gradient bridge, tags, highlights. On white: 5.1:1 (AA, safe for text).'), true);
check('an AA Large color is marked large text only', has(md, 'On white: 3.6:1 (AA Large, large text only).'), true);
check('a color with no pair on white claims nothing', has(md, '- **Salmon** `#F77D73`: Secondary. Warm CTA accent, gradient end.\n'), true);

// {label, items} is today's shape, a bare array is what Freeway ships.
var grouped = clone(freeway);
grouped.colors.brand = { label: 'Brand', items: freeway.colors.brand };
grouped.colors.neutrals = { label: 'Neutrals', items: freeway.colors.neutrals };
check('both color group shapes produce the same brief', exporter.buildBrandMarkdown(grouped), md);

var noNeutrals = clone(freeway);
delete noNeutrals.colors.neutrals;
var mdNoNeutrals = exporter.buildBrandMarkdown(noNeutrals);
check('without colors.neutrals the theme fallback still prints',
  has(mdNoNeutrals, '- **Neutrals:** Ink `#100C2E` (primary text), Slate `#67648C` (muted), Cloud `#F6F6FB` (page bg).'), true);

var noPalette = clone(freeway);
delete noPalette.colors;
var mdNoPalette = exporter.buildBrandMarkdown(noPalette);
check('without colors there is no Palette block', has(mdNoPalette, '**Palette:**'), false);
check('and no Usage label either, the old layout stands', has(mdNoPalette, '**Usage:**'), false);

var markerColor = clone(freeway);
markerColor.colors.brand[0].role = '__TODO: describe the role';
check('an unfilled role is omitted, not printed', has(exporter.buildBrandMarkdown(markerColor), '__TODO'), false);

/* ---------------- 2. brand.md carries the type scale and spacing ---------------- */

check('type scale header', has(md, '| Style | Font | Size | Weight | Tracking | Leading |'), true);
freeway.typography.forEach(function (t) {
  check('type scale row ' + t.name,
    has(md, '| ' + [t.name, t.font, t.size, t.weight, t.tracking, t.leading].join(' | ') + ' |'), true);
});
check('spacing scale is one line', has(md, '- **Scale:** `space-1` 4px, `space-2` 8px,'), true);
var bj = exporter.buildBrandJson(freeway);
check('brand.json scale carries tracking and leading', [bj.type.scale[0].tracking, bj.type.scale[0].leading], ['-0.03em', '1.05']);

/* ---------------- 3. tokens.json carries the palette ---------------- */

var tokens = exporter.buildTokensJson(freeway);
check('Plum is a token', tokens.color.palette.plum.$value, '#A65188');
check('Pink is a token', tokens.color.palette.pink.$value, '#D56181');
check('the role is the description', tokens.color.palette.plum.$description, 'Accent. Gradient bridge, tags, highlights');
var plumExt = tokens.color.palette.plum.$extensions['app.stacklist.brandkit'];
check('oklch rides in $extensions as authored + colorSpace, $value stays hex',
  [plumExt.authored, plumExt.colorSpace, tokens.color.palette.plum.$value], ['oklch(0.56 0.13 343)', 'oklch', '#A65188']);
check('there is no second convention', 'oklch' in plumExt, false);
var themeWide = exporter.buildTokensJson({ theme: { '--accent': 'oklch(0.56 0.13 343)' }, colors: { brand: [{ name: 'Plum', oklch: 'oklch(0.56 0.13 343)' }, { name: 'Flat', hex: '#A65188' }, { name: 'Short', hex: '#abc' }] } });
var tExt = themeWide.color.accent.$extensions['app.stacklist.brandkit'], pExt = themeWide.color.palette.plum.$extensions['app.stacklist.brandkit'];
check('a palette token and a theme token describe a wide-gamut value identically',
  [pExt.authored, pExt.colorSpace], [tExt.authored, tExt.colorSpace]);
check('a plain hex color carries no authored value', 'authored' in themeWide.color.palette.flat.$extensions['app.stacklist.brandkit'], false);
check('a shorthand hex keeps what the author wrote, as theme tokens do',
  [themeWide.color.palette['short'].$value, themeWide.color.palette['short'].$extensions['app.stacklist.brandkit'].authored], ['#AABBCC', '#abc']);
check('neutrals are tokens too', tokens.color.palette.graphite.$value, '#36325A');
check('flat theme tokens are where they were', tokens.color.accent, { $type: 'color', $value: '#281D73' });
check('every flat theme token survives',
  Object.keys(tokens.color).filter(function (k) { return k !== 'palette'; }).length,
  Object.keys(freeway.theme).filter(function (k) { return !/-rgb$/.test(k) && !/gradient/.test(k); }).length);

var collide = clone(freeway);
collide.theme['--palette'] = '#123456';
var tc = exporter.buildTokensJson(collide);
check('a --palette theme variable keeps its token', tc.color.palette.$value, '#123456');
check('and the palette group moves aside rather than overwrite it', tc.color['brand-palette'].plum.$value, '#A65188');

var dupes = { colors: { brand: [{ name: 'Blue', hex: '#0000FF' }], neutrals: [{ name: 'blue', hex: '#000088' }] } };
check('same-named colors do not overwrite each other',
  Object.keys(exporter.buildTokensJson(dupes).color.palette), ['blue', 'blue-2']);
check('a color with no measurable value is not a token',
  exporter.buildTokensJson({ colors: { brand: [{ name: 'Mystery', hex: '__TODO' }] } }).color, undefined);

/* ---------------- 4. No em or en dashes in generated output ---------------- */

check('the fixture itself is dash-free (or this section proves nothing)', DASHES.test(JSON.stringify(withFormats)), false);
[['Freeway', freeway], ['Freeway with formats', withFormats], ['the starter', schema.starterConfig()]].forEach(function (pair) {
  check(pair[0] + ': brand.md has no dashes', DASHES.test(exporter.buildBrandMarkdown(pair[1])), false);
  check(pair[0] + ': brand.json has no dashes', DASHES.test(JSON.stringify(exporter.buildBrandJson(pair[1]))), false);
  check(pair[0] + ': tokens.json has no dashes', DASHES.test(JSON.stringify(exporter.buildTokensJson(pair[1]))), false);
});

// The package's own files: shipped code, the microsite template, its default
// copy, the schema and the README. Escapes count, they are dashes at runtime.
// The two allowed files match a dash on purpose, by escape, to recognize one
// in a client's content.
var ESCAPED = /\\u201[34]|&[mn]dash;|&#821[12];/;
var ALLOW_ESCAPE = ['lib/export.js', 'lib/config-schema.js'];
var offenders = [];
function scan(rel) {
  var abs = path.join(__dirname, '..', rel);
  if (fs.statSync(abs).isDirectory()) {
    fs.readdirSync(abs).forEach(function (f) { scan(path.join(rel, f)); });
    return;
  }
  if (!/\.(js|json|md|css|html|svg)$/.test(rel)) return;
  var text = fs.readFileSync(abs, 'utf8');
  var posix = rel.split(path.sep).join('/');
  if (DASHES.test(text)) offenders.push(posix);
  else if (ESCAPED.test(text) && ALLOW_ESCAPE.indexOf(posix) === -1) offenders.push(posix + ' (escaped)');
}
['bin', 'cli', 'lib', 'dist', 'integrations', 'example', 'README.md', 'config.schema.json'].forEach(scan);
check('no dashes anywhere in the shipped package or the demo', offenders, []);

// A client's own dash is theirs to keep: stripped from the family prefix, as
// before, but never rewritten inside their prose.
var legacyFont = { fonts: { body: { family: 'Inter', description: 'Inter \u2014 a workhorse' } } };
check('a legacy "Family (dash) description" prefix is still stripped',
  has(exporter.buildBrandMarkdown(legacyFont), '- **Body:** Inter: a workhorse'), true);

/* ---------------- 5. Rewording the starter did not break provenance ---------------- */

var legacy = fixture('starter-1.6.0.json');
var current = schema.starterConfig();
Object.keys(legacy).forEach(function (key) {
  if (key === 'brand') return; // version and date differ by design
  check('a 1.6.0 scaffold "' + key + '" still reads as scaffold', schema.copyKey(legacy[key]), schema.copyKey(current[key]));
});
['name', 'displayName', 'tagline', 'description', 'url', 'byline'].forEach(function (k) {
  check('a 1.6.0 scaffold brand.' + k + ' still reads as scaffold', schema.copyKey(legacy.brand[k]), schema.copyKey(current.brand[k]));
});
check('the 1.6.0 starter really did differ (or this section proves nothing)',
  JSON.stringify(legacy.voice) === JSON.stringify(current.voice), false);
check('reworded copy is authored, not scaffold',
  schema.copyKey('Primary lockup. Use on dark backgrounds.') === schema.copyKey(current.logos[0].description), false);

// Loose comparison is for prose only. A machine value that differs at all is
// the author's: generate must not delete a logo because its path changed case.
var logoEdit = clone(current.logos[0]);
logoEdit.variants.svg = 'logos/Brandkit-wordmark-dark.svg';
check('a case-only path edit is authored', schema.copyKey(logoEdit) === schema.copyKey(current.logos[0]), false);
var typeEdit = clone(current.typography[0]);
typeEdit.leading = '1:05';
check('a punctuation-only CSS value edit is authored', schema.copyKey(typeEdit) === schema.copyKey(current.typography[0]), false);
var hexEdit = clone(current.colors.brand.items[0]);
hexEdit.hex = hexEdit.hex.toLowerCase();
check('a hex case edit is authored', schema.copyKey(hexEdit) === schema.copyKey(current.colors.brand.items[0]), false);
check('content under an own __proto__ key is not hidden from the comparison',
  schema.copyKey(JSON.parse('{"description":"x","__proto__":{"mine":"authored"}}')) === schema.copyKey({ description: 'x' }), false);
check('a marker in the neutrals fallback is not printed',
  has(exporter.buildBrandMarkdown({ theme: { '--ink': '__TODO: choose', '--slate': '#67648C' } }), '__TODO'), false);
check('a marker clear space is no rule at all', formatsLib.normalizeClearSpace({ rule: '__TODO: define', ratio: 0.5 }), { ratio: 0.5 });
var fontEdit = clone(current.fonts.display);
fontEdit.family = fontEdit.family.toLowerCase();
check('a font family edit is authored', schema.copyKey(fontEdit) === schema.copyKey(current.fonts.display), false);
check('a punctuation-only prose edit is still scaffold',
  schema.copyKey({ description: 'Primary lockup; use on light backgrounds' }), schema.copyKey({ description: current.logos[0].description }));

/* ---------------- 6. Formats and logo usage ---------------- */

check('a preset supplies the canvas', formatsLib.resolveFormat('social-square'),
  { preset: 'social-square', name: 'Social square (1:1)', kind: 'social', width: 1080, height: 1080, unit: 'px' });
check('dimensions are an alias for the preset', formatsLib.resolveFormat('1200x630').preset, 'link-card');
['1080x1080', '1080x1350', '1080x1920', '1200x630', '1920x1080'].forEach(function (d) {
  var f = formatsLib.resolveFormat(d);
  check('preset ' + d + ' exists with those dimensions', f.width + 'x' + f.height, d);
});
check('the entry overrides the preset', formatsLib.resolveFormat({ preset: 'social-square', name: 'Instagram square' }).name, 'Instagram square');
check('an unknown preset is reported, not guessed',
  formatsLib.resolveFormat({ preset: 'tiktok-banner' }), { unknownPreset: 'tiktok-banner' });
check('a number is an inset on every side', formatsLib.normalizeSafeZone(80, 'px'), { top: 80, right: 80, bottom: 80, left: 80, unit: 'px' });
check('a side overrides all', formatsLib.normalizeSafeZone({ all: 60, bottom: 90 }, 'px'), { top: 60, right: 60, bottom: 90, left: 60, unit: 'px' });
check('no safe zone is null, not zeros', formatsLib.normalizeSafeZone(undefined, 'px'), null);

var bjf = exporter.buildBrandJson(withFormats);
check('brand.json carries logoUsage', bjf.logoUsage.clearSpace, { rule: 'the height of the F mark on all sides', ratio: 0.5 });
check('brand.json carries min sizes', bjf.logoUsage.minSize, { digitalPx: 96, printMm: 25 });
check('brand.json carries three formats', bjf.formats.map(function (f) { return f.name; }),
  ['Instagram square', 'LinkedIn link card', 'Slide 16:9']);
check('the logo variant resolves to its file', bjf.formats[0].logo.src, '/brand/logos/freeway-white.svg');
check('a palette background resolves to its hex', bjf.formats[0].background[0], { type: 'color', name: 'Indigo', hex: '#281D73', oklch: 'oklch(0.31 0.14 280)' });
check('"gradient" resolves to the brand gradient', bjf.formats[0].background[1].css, freeway.theme['--gradient-brand']);
check('a type role resolves against the scale, keeping the override',
  bjf.formats[0].typography.headline,
  { style: 'H1', size: '76px', sizeOverridden: true, family: 'Hanken Grotesk', weight: 700, tracking: '-0.02em', leading: '1.15' });
check('without an override the scale size stands', bjf.formats[2].typography.headline.size, '44px');

var plain = exporter.buildBrandJson(freeway);
check('no formats in config, no formats key', 'formats' in plain, false);
check('no logo usage in config, no logoUsage key', 'logoUsage' in plain, false);
check('and no per-logo usage key', 'usage' in plain.logos[0], false);

var perLogo = clone(freeway);
perLogo.logos[1].minSize = { digitalPx: 120 };
check('a rule set on one logo exports on that logo', exporter.buildBrandJson(perLogo).logos[1].usage, { minSize: { digitalPx: 120 } });
check('with no brand-wide rules it does not claim to override any',
  has(exporter.buildBrandMarkdown(perLogo), '\n**Logotype White (#FFFFFF)**:\n'), true);
var perLogoBoth = clone(withFormats);
perLogoBoth.logos[1].minSize = { digitalPx: 120 };
check('with brand-wide rules it reads as an override',
  has(exporter.buildBrandMarkdown(perLogoBoth), '**Logotype White (#FFFFFF)** (overrides the rules above for this logo):'), true);

var mdf = exporter.buildBrandMarkdown(withFormats);
check('brief has no new sections without the fields', has(md, '## Formats') || has(md, '## Logo usage'), false);
check('brief: clear space is an instruction',
  has(mdf, '- **Clear space:** keep at least the height of the F mark on all sides (0.5x the logo height) free of text, imagery and the canvas edge.'), true);
check('brief: minimum size', has(mdf, '- **Minimum size:** never render it smaller than 96px wide on screen, or 25mm wide in print.'), true);
check('brief: misuse rules', has(mdf, '  - Stretch, squash or rotate the logo'), true);
check('brief: format heading has dimensions and kind', has(mdf, '### Instagram square (1080 x 1080 px, social)'), true);
check('brief: safe zone with usable area', has(mdf, '- **Safe zone:** inset 80px on every side. Usable area: 920 x 920 px.'), true);
check('brief: uneven safe zone', has(mdf, '- **Safe zone:** inset top 60px, right 60px, bottom 90px, left 60px. Usable area: 1080 x 480 px.'), true);
check('brief: where the logo goes',
  has(mdf, '- **Logo:** use "Logotype White (#FFFFFF)" (`/brand/logos/freeway-white.svg`), placed bottom left, no wider than 260px.'), true);
check('brief: which type to use',
  has(mdf, '- **Headline type:** H1 at 76px (overrides the web size for this canvas): Hanken Grotesk, weight 700, tracking -0.02em, leading 1.15.'), true);
check('brief: which backgrounds are allowed',
  has(mdf, '- **Backgrounds:** only Indigo `#281D73`; the brand gradient `linear-gradient('), true);

var broken = clone(freeway);
broken.formats = [{ preset: 'tiktok-banner', name: 'TikTok', typography: { headline: 'Mega' }, background: [{ color: 'Teal' }] }];
var mdBroken = exporter.buildBrandMarkdown(broken);
check('an unknown preset is reported as a gap', has(mdBroken, '- Format "TikTok": unknown preset "tiktok-banner", no dimensions'), true);
check('a style missing from the scale is reported', has(mdBroken, '- Format "TikTok": type style "Mega" is not in the type scale'), true);
check('a color missing from the palette is reported', has(mdBroken, '- Format "TikTok": background color "Teal" is not in the palette'), true);

/* ---------------- 6b. Markers and odd input never reach an export ---------------- */

var hostile = {
  brand: { name: 'x' },
  theme: { '--palette': '#111111', '--brand-palette': '#222222' },
  spacing: [{ token: 'md', px: '__TODO: fill me' }, { token: 'sm', px: '8px' }, { token: 'lg', px: 24 }, null],
  colors: { brand: [null, 'red', { name: '__TODO', label: 'Real', hex: '#123456', role: '__TODO', usage: 'Real usage' },
                    { name: 'constructor', hex: '#000000' }, { name: 'A\n## Injected', hex: '#FFFFFF' }] },
  typography: [{ name: 'Dis|play\nX', font: 'a\nb', size: '1', weight: 1 }],
  logos: [{ name: 'Mark', variants: { svg: 'm.svg' }, minSize: { digitalPx: 0, printMm: -3 } }],
  logoUsage: { placement: 'top left', dont: [{ nope: 1 }, 'Stretch it'], minSize: null, clearSpace: 7 },
  formats: [
    {}, '__TODO: add', true, null,
    { preset: 'social-square', name: '__TODO', width: '__TODO', kind: '__TODO', unit: '__TODO: x', safeZone: 600,
      logo: { variant: 'Nope' }, typography: ['H1'], background: [{ color: '__TODO: pick' }, null, 'no gradients please'] },
    { preset: 'ig-square', width: 1080, height: 1080, safeZone: -40, notes: 'A\n## Injected' }
  ]
};
var hmd = '', hj = null, ht = null, threw = null;
try {
  hmd = exporter.buildBrandMarkdown(hostile); hj = exporter.buildBrandJson(hostile); ht = exporter.buildTokensJson(hostile);
} catch (e) { threw = e.message; }
check('hostile input does not throw', threw, null);
var hall = hmd + JSON.stringify(hj) + JSON.stringify(ht);
check('no marker reaches any export', has(hall, '__TODO'), false);
check('no "undefined", "NaN" or "[object Object]" is printed', /undefined|NaN|\[object Object\]/.test(hall), false);
check('a newline in a value cannot start a markdown heading', /^## Injected/m.test(hmd), false);
check('the type scale row stays on one line', has(hmd, '| Dis/play X | a b | 1 | 1 |  |  |'), true);
check('spacing keeps only real dimensions', has(hmd, '- **Scale:** `sm` 8px, `lg` 24px.'), true);
check('and so do the tokens', ht.dimension, { sm: { $type: 'dimension', $value: '8px' }, lg: { $type: 'dimension', $value: '24px' } });
check('a marker name falls back to the label', has(hmd, '- **Real** `#123456`: Real usage.'), true);
check('a color named "constructor" keeps its own key', Object.keys(ht.color['brand-brand-palette']).indexOf('constructor') !== -1, true);
check('the palette group never overwrites a theme token', [ht.color.palette.$value, ht.color['brand-palette'].$value, typeof ht.color['brand-brand-palette']], ['#111111', '#222222', 'object']);
check('markers do not displace the preset', [hj.formats[0].name, hj.formats[0].width, hj.formats[0].kind, hj.formats[0].unit], ['Social square (1:1)', 1080, 'social', 'px']);
check('hollow entries are not formats', hj.formats.length, 2);
check('an unknown preset with its own dimensions is not "no dimensions"', has(hmd, 'unknown preset "ig-square"\n') || /unknown preset "ig-square"$/m.test(hmd), true);
check('a safe zone that leaves nothing is reported, not computed', [has(hmd, 'Usable area: -'), has(hmd, 'the safe zone leaves no usable area')], [false, true]);
check('a negative safe zone is dropped', 'safeZone' in hj.formats[1], false);
check('an unknown logo variant is reported', has(hmd, 'logo "Nope" is not in the logos list'), true);
check('non-positive minimum sizes are dropped', 'usage' in hj.logos[0], false);
var typeOnly = exporter.buildBrandJson({ formats: [{ preset: 'link-card', background: [{ type: 'photo' }, { type: '__TODO' }, {}] }] });
check('a background given only as a type is kept, hollow ones are not', typeOnly.formats[0].background, [{ type: 'photo' }]);
check('but a color type that names no color is not a background',
  'background' in exporter.buildBrandJson({ formats: [{ preset: 'link-card', background: [{ type: 'color' }, { type: 'other' }] }] }).formats[0], false);
var markerLog = exporter.buildBrandMarkdown({ changelog: [{ version: '__TODO: 0.1', date: '__TODO: today', changes: ['__TODO: what changed'] },
  { version: '0.2', date: '__TODO: when', changes: ['Real change', '__TODO'] }] });
check('no marker reaches the revision history', has(markerLog, '__TODO'), false);
check('an entry with nothing filled is not listed, a real one is', [has(markerLog, 'v?'), has(markerLog, '- **v0.2**: Real change')], [false, true]);
var emptyHeads = exporter.buildBrandMarkdown({ logos: ['bad', {}, { variants: { svg: 'a.svg' } }], changelog: [null] });
check('no Logos heading without a nameable logo', has(emptyHeads, '## Logos'), false);
check('no revision history heading without an entry', has(emptyHeads, 'Revision history'), false);
check('a newline in a logo name cannot start a heading',
  /^## Injected/m.test(exporter.buildBrandMarkdown({ logos: [{ name: 'Mark\n## Injected', variants: { svg: 'a.svg' } }] })), false);
check('an empty Usage heading is never printed', has(exporter.buildBrandMarkdown({ colors: { brand: [{ name: 'A', hex: '#000000' }] } }), '**Usage:**'), false);

/* ---------------- 7. The microsite mirrors the library ---------------- */

var engine = fs.readFileSync(path.join(__dirname, '..', 'dist', 'engine.js'), 'utf8');
var html = fs.readFileSync(path.join(__dirname, '..', 'dist', 'index.html'), 'utf8');
var presetSrc = engine.match(/var FORMAT_PRESETS = (\{[\s\S]*?\n    \});/);
var aliasSrc = engine.match(/var PRESET_ALIASES = (\{[\s\S]*?\n    \});/);
check('engine.js presets match lib/formats.js', presetSrc && new Function('return ' + presetSrc[1])(), formatsLib.FORMAT_PRESETS);
check('engine.js aliases match lib/formats.js', aliasSrc && new Function('return ' + aliasSrc[1])(), formatsLib.PRESET_ALIASES);
check('the logo usage section ships hidden', /<div class="section" id="logo-usage" hidden>/.test(html), true);
check('the formats section ships hidden', /<div class="section" id="formats" hidden>/.test(html), true);
check('both renderers are called', has(engine, '    renderLogoUsage();\n    renderFormats();'), true);

/* ---------------- 8. The renderers, run without a browser ---------------- */

// engine.js is one IIFE with no exports, so the new functions are lifted out as
// text and run against a stub document.
function lift(startMarker, endMarker) {
  var from = engine.indexOf(startMarker), to = engine.indexOf(endMarker, from);
  return from === -1 || to === -1 ? null : engine.slice(from, to);
}
var lifted = [
  lift('    function esc(s) {', '    /**'),
  lift('    function isUnset(v) {', '    /**'),
  lift('    function navWithOptionalSections(nav) {', '    /* ===='),
  lift('    var FORMAT_PRESETS = {', '    /* ====')
];
check('the engine functions could be lifted', lifted.every(Boolean), true);
function page(cfg) {
  var els = {};
  ['logo-usage', 'logo-usage-content', 'formats', 'formats-grid'].forEach(function (id) { els[id] = { hidden: true, innerHTML: '' }; });
  var doc = { getElementById: function (id) { return els[id] || null; } };
  var api = new Function('cfg', 'document', lifted.join('\n') +
    '\nreturn { nav: navWithOptionalSections, formats: resolvedFormats, zone: safeZoneOf, usage: renderLogoUsage, render: renderFormats };')(cfg, doc);
  return { api: api, els: els };
}
function navIds(p, nav) {
  return p.api.nav(nav).map(function (g) { return g.group + ':' + g.items.map(function (i) { return i.id; }).join(','); });
}

var legacyNav = [{ group: 'Logos', items: [{ label: 'Downloads', id: 'logos' }] }, { group: 'Content', items: [{ label: 'Voice', id: 'voice' }] }];
var oddLogos = page({ logos: {}, nav: legacyNav });
var navThrew = null;
try { navIds(oddLogos, legacyNav); oddLogos.api.usage(); oddLogos.api.render(); } catch (e) { navThrew = e.message; }
check('a non-array logos does not take the nav (and the page) down', navThrew, null);

var legacyPage = page({ logos: freeway.logos, nav: legacyNav });
legacyPage.api.usage(); legacyPage.api.render();
check('a legacy config gets exactly its own nav', navIds(legacyPage, legacyNav), ['Logos:logos', 'Content:voice']);
check('and both sections stay hidden', [legacyPage.els['logo-usage'].hidden, legacyPage.els.formats.hidden], [true, true]);

var fullPage = page({ logos: freeway.logos, nav: legacyNav, logoUsage: extras.logoUsage, formats: extras.formats });
fullPage.api.usage(); fullPage.api.render();
check('adopting the fields adds the links without a nav edit', navIds(fullPage, legacyNav), ['Logos:logos,logo-usage', 'Formats:formats', 'Content:voice']);
check('and reveals both sections', [fullPage.els['logo-usage'].hidden, fullPage.els.formats.hidden], [false, false]);
check('three format cards', fullPage.els['formats-grid'].innerHTML.split('class="format-card"').length - 1, 3);
var authoredNav = [{ group: 'Brand', items: [{ label: 'Marks', id: 'logos' }, { label: 'Rules', id: 'logo-usage' }, { label: 'Sizes', id: 'formats' }] }];
check('an authored link is never duplicated', navIds(fullPage, authoredNav), ['Brand:logos,logo-usage,formats']);

var hollowPage = page({ nav: legacyNav, formats: [{}, '', [1], null, { preset: '' }, '__TODO: add'], logoUsage: { minSize: { digitalPx: 0 }, dont: ['__TODO'] } });
hollowPage.api.usage(); hollowPage.api.render();
check('hollow entries reveal nothing and add no links', [hollowPage.els.formats.hidden, hollowPage.els['logo-usage'].hidden, navIds(hollowPage, legacyNav)], [true, true, ['Logos:logos', 'Content:voice']]);

var xss = '"><img src=x onerror=alert(1)>';
var xssPage = page({ logos: [{ name: xss, dont: [xss] }], formats: [{ name: xss, kind: xss, unit: xss, width: 100, height: 100, notes: xss, safeZone: 10,
  logo: { variant: xss, placement: xss, note: xss }, typography: { headline: { style: xss, size: xss } }, background: [xss, { color: xss, overlay: xss }] }] });
xssPage.api.usage(); xssPage.api.render();
check('no config value reaches the page as markup', /<img/.test(xssPage.els['formats-grid'].innerHTML + xssPage.els['logo-usage-content'].innerHTML), false);

// Same input, same canvas: the page must not say one thing and brand.json another.
[ 'social-square', '1200x630', ' Slide-16x9 ', { preset: 'link-card', name: 'LinkedIn' }, { preset: 'slide-16x9', kind: 'banner' },
  { name: 'Poster', kind: 'print', width: 297, height: 420, unit: 'mm' }, { preset: 'nope', name: 'X' }, { preset: 0, name: 'Y' },
  { preset: ['social-square'], name: 'Z' }, { preset: 'social-square', name: '__TODO', width: '__TODO' }
].forEach(function (entry) {
  var fromEngine = page({ formats: [entry] }).api.formats()[0] || {};
  var fromLib = formatsLib.resolveFormat(entry) || {};
  function canvas(x) { return [x.name, x.kind, x.width, x.height, x.unit, x.unknownPreset]; }
  check('engine and library agree on ' + JSON.stringify(entry), canvas(fromEngine), canvas(fromLib));
});
// ...and on how many formats a brand defines at all.
var countCfg = { formats: [{ notes: 'print on uncoated stock' }, { kind: 'video' }, {}, 'social-square', { name: 'Poster' }, { preset: 'nope' }] };
check('the page and the exports count the same formats',
  [page(countCfg).api.formats().length, formatsLib.resolveFormats(countCfg).length, exporter.buildBrandJson(countCfg).formats.length], [3, 3, 3]);
var objRules = page({ logoUsage: { dont: [{ rule: 'stretch it' }, 'Recolor it'], placement: [{ a: 1 }] } });
objRules.api.usage();
check('an object in a rule list is never printed', /object Object/.test(objRules.els['logo-usage-content'].innerHTML), false);
[{ ratio: 0 }, { ratio: -1 }, { rule: '__TODO', ratio: 0 }, 7, { rule: 'the F height', ratio: 0.5 }, 'the F height'].forEach(function (cs) {
  var shown = page({ logoUsage: { clearSpace: cs } });
  shown.api.usage();
  check('page and exports agree on whether clearSpace ' + JSON.stringify(cs) + ' is a rule',
    !shown.els['logo-usage'].hidden, formatsLib.normalizeClearSpace(cs) !== null);
});
var cjk = exporter.buildTokensJson({ colors: { brand: [{ name: '\u85CD', hex: '#0000FF', cssVar: '--brand-ai' }, { name: '\u2605', hex: '#FF0000' }] }, spacing: [{ token: '__proto__', px: 8 }, { token: 'sm', px: 8 }] });
check('a non-Latin color name still becomes a token', Object.keys(cjk.color.palette), ['brand-ai', 'brand-2']);
check('a __proto__ spacing token cannot replace the group prototype', Object.keys(cjk.dimension), ['sm']);

[80, -5, { all: 60, bottom: 90 }, { top: 10 }, { all: 10, unit: 'mm' }, { left: -1 }, 'x', [1], {}].forEach(function (z) {
  var fmt = { width: 100, height: 100, unit: 'px', safeZone: z };
  check('engine and library agree on safeZone ' + JSON.stringify(z), page({}).api.zone(fmt), formatsLib.normalizeSafeZone(z, 'px'));
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
