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

var DASHES = /[—–]/;
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
check('oklch rides in $extensions, $value stays hex',
  tokens.color.palette.plum.$extensions['app.stacklist.brandkit'].oklch, 'oklch(0.56 0.13 343)');
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
var legacyFont = { fonts: { body: { family: 'Inter', description: 'Inter — a workhorse' } } };
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
check('and appears in the brief as an override',
  has(exporter.buildBrandMarkdown(perLogo), '**Logotype White (#FFFFFF)** (overrides the rules above for this logo):'), true);

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

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
