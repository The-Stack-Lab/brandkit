/**
 * Regression tests for the Tailwind 4 / shadcn CSS-first integration defects.
 *
 * Reported from a Next.js 16 + Tailwind 4 + shadcn/ui project where every one
 * of these failed silently — exit 0, cheerful output, wrong result. Each case
 * names the failure it locks out.
 */
var os = require('os');
var path = require('path');
var fs = require('fs');
var extractCSS = require('../lib/extract-css');
var helpers = require('../lib/generate-helpers');
var exporter = require('../lib/export');
var schema = require('../lib/config-schema');

var I = extractCSS._internals;

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

/* ------------------------------------------------------------------ *
 * 1. @theme inline — what `npx shadcn init` actually writes
 * ------------------------------------------------------------------ */

var THEME_FORMS = ['@theme {', '@theme inline {', '@theme static {', '@theme default {'];
THEME_FORMS.forEach(function (head) {
  var vars = I.extractFromContent(head + '\n  --font-display: Archivo;\n}');
  check('parses "' + head + '"', vars['--font-display'], 'Archivo');
});

// The block reader must not stop at the first '}' — a nested rule used to
// truncate everything after it.
check('nested braces do not truncate the block',
  I.extractFromContent('@theme inline {\n  --a: 1px;\n  @media (min-width:0){ --ignored: 2px; }\n  --b: 3px;\n}')['--b'],
  '3px');

// A brace inside a comment must not unbalance the reader.
check('brace in a comment does not break parsing',
  I.extractFromContent(':root {\n  /* } */\n  --a: #FFF;\n}')['--a'],
  '#FFF');

/* ------------------------------------------------------------------ *
 * 2. var() resolution — the shadcn token ladder
 * ------------------------------------------------------------------ */

var ladder = I.resolveVarRefs({
  '--brand': 'oklch(0.3623 0.1583 269.14)',
  '--primary': 'var(--brand)',
  '--ring': 'var(--absent, #ABCDEF)',
  '--nested': 'var(--absent, var(--brand))',
  '--cycle-a': 'var(--cycle-b)',
  '--cycle-b': 'var(--cycle-a)',
  '--self': 'var(--self)',
  '--unknown': '1px solid var(--nowhere)',
  '--twice': 'var(--brand) 0%, var(--brand) 100%',
  '--mixed': 'color-mix(in oklab, var(--brand) 50%, white)'
});

check('alias resolves to its literal', ladder['--primary'], 'oklch(0.3623 0.1583 269.14)');
check('declared fallback is used', ladder['--ring'], '#ABCDEF');
check('fallback containing a var() resolves', ladder['--nested'], 'oklch(0.3623 0.1583 269.14)');
check('mutual cycle is left literal, not hung', ladder['--cycle-a'], 'var(--cycle-b)');
check('self-reference is left literal', ladder['--self'], 'var(--self)');
check('unresolvable reference is kept as authored', ladder['--unknown'], '1px solid var(--nowhere)');
check('every occurrence is substituted', ladder['--twice'],
  'oklch(0.3623 0.1583 269.14) 0%, oklch(0.3623 0.1583 269.14) 100%');
check('var() inside another function resolves', ladder['--mixed'],
  'color-mix(in oklab, oklch(0.3623 0.1583 269.14) 50%, white)');

/* ------------------------------------------------------------------ *
 * 3. Color parsing — oklch is the Tailwind 4 default
 * ------------------------------------------------------------------ */

check('oklch white round-trips', helpers.parseCssColor('oklch(1 0 0)').hex, '#FFFFFF');
check('oklch black round-trips', helpers.parseCssColor('oklch(0 0 0)').hex, '#000000');
check('rgb() parses', helpers.parseCssColor('rgb(255 0 0)').hex, '#FF0000');
check('hsl() parses', helpers.parseCssColor('hsl(0 100% 50%)').hex, '#FF0000');
check('named color parses', helpers.parseCssColor('white').hex, '#FFFFFF');
check('authored value is preserved', helpers.parseCssColor('oklch(0.5 0.1 200)').original, 'oklch(0.5 0.1 200)');

// The OKLab inverse must be exact, not approximate — swatches and contrast
// ratios are computed from it.
var exact = ['#4F46E5', '#00FF00', '#0000FF', '#F9FAFB', '#111827', '#ABCDEF'].every(function (hex) {
  var rgb = helpers.toRgb(hex);
  // full-precision forward transform, then back
  function s2l(c) { c = c / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  var lr = s2l(rgb.r), lg = s2l(rgb.g), lb = s2l(rgb.b);
  var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  var A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  var B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  var C = Math.sqrt(A * A + B * B), H = Math.atan2(B, A) * 180 / Math.PI;
  if (H < 0) H += 360;
  return helpers.parseCssColor('oklch(' + L + ' ' + C + ' ' + H + ')').hex === hex.toUpperCase();
});
check('OKLab inverse is exact for sRGB colors', exact, true);

// Things that are NOT a single color must never become one.
check('gradient is not a color', helpers.parseCssColor('linear-gradient(135deg, #fff 0%, #000 100%)'), null);
check('"r, g, b" triple is not a color', helpers.parseCssColor('79, 70, 229'), null);
check('unresolved var() is not a color', helpers.parseCssColor('var(--brand)'), null);
check('empty is not a color', helpers.parseCssColor(''), null);

/* ------------------------------------------------------------------ *
 * 4. Contrast must never fabricate a passing score
 *
 * hexToRgb() coerced any non-hex string to {0,0,0}, so an oklch value scored
 * 21.0:1 — a perfect, AAA-rated claim — in a client-facing a11y table.
 * ------------------------------------------------------------------ */

check('unparseable contrast is null, not 21.0:1', helpers.contrastRatio('var(--x)', '#FFFFFF'), null);
check('rating of an unmeasured pair is null', helpers.rateContrast(null), null);
check('oklch contrast is measured for real',
  helpers.contrastRatio('oklch(0 0 0)', '#FFFFFF'), '21.0:1');
check('isLightColor is false for unparseable input', helpers.isLightColor('var(--x)'), false);

/* ------------------------------------------------------------------ *
 * 5. Theme mapping is 1:1 — no silent overwrite
 * ------------------------------------------------------------------ */

var warnings = [];
var theme = extractCSS.mapToTheme({
  '--background': '#FFFFFF',
  '--foreground': '#000000',
  '--primary': '#111111',
  '--secondary': '#222222',
  '--muted': '#333333',
  '--border': '#444444'
}, { warn: function (m) { warnings.push(m); } });

check('border owns --mist', theme['--mist'], '#444444');
check('muted keeps its own slot', theme['--haze'], '#333333');
check('secondary is passed through, not dropped', theme['--secondary'], '#222222');
check('primary becomes the accent', theme['--accent'], '#111111');
check('no collisions on a stock shadcn theme', warnings.length, 0);

// A token pointing at something the stylesheet never defines (a next/font
// variable, say) cannot render, so it must not be written into the theme.
var dangling = [];
var t2 = extractCSS.mapToTheme(
  { '--font-display': 'var(--font-archivo)', '--ink': '#111111' },
  { warn: function (m) { dangling.push(m); } });
check('dangling var() is not written to the theme', t2['--font-display'], undefined);
check('dangling var() is reported', dangling.length, 1);
check('resolvable tokens are unaffected', t2['--ink'], '#111111');

/* ------------------------------------------------------------------ *
 * 6. Fonts come from CSS custom properties on Tailwind 4
 * ------------------------------------------------------------------ */

check('display font from --font-display',
  extractCSS.fontsFromVars({ '--font-display': "'Archivo', sans-serif" }).display.family, 'Archivo');
check('body font from --font-sans',
  extractCSS.fontsFromVars({ '--font-sans': "'Inter', ui-sans-serif" }).body.family, 'Inter');
check('next/font variable yields the family name',
  extractCSS.fontsFromVars({ '--font-display': 'var(--font-space-grotesk)' }).display.family,
  'Space Grotesk');
check('a bare generic keyword is not a brand font',
  extractCSS.fontsFromVars({ '--font-sans': 'sans-serif' }), null);
check('--font-heading is accepted for display',
  extractCSS.fontsFromVars({ '--font-heading': 'Archivo' }).display.family, 'Archivo');

/* ------------------------------------------------------------------ *
 * 7. DTCG export emits colors on an oklch project
 * ------------------------------------------------------------------ */

var tokens = exporter.buildTokensJson({
  brand: { name: 'acme' },
  theme: {
    '--accent': 'oklch(0.3623 0.1583 269.14)',
    '--ink': '#111827',
    '--accent-rgb': '79, 70, 229',
    '--gradient-brand': 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)'
  }
});

check('color group is emitted for an oklch theme', !!tokens.color, true);
check('oklch token gets an sRGB hex $value', tokens.color.accent.$value, '#1F2F8F');
check('authored oklch is preserved in $extensions',
  tokens.color.accent.$extensions['app.stacklist.brandkit'].authored,
  'oklch(0.3623 0.1583 269.14)');
check('a hex token needs no $extensions', tokens.color.ink.$extensions, undefined);
check('tint triple is excluded', tokens.color['accent-rgb'], undefined);
check('gradient is excluded', tokens.color['gradient-brand'], undefined);

/* ------------------------------------------------------------------ *
 * 8. Brand identity is seeded from the host, never left as brandkit's
 * ------------------------------------------------------------------ */

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-identity-'));
fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'barone-steel' }));

var cfg = schema.starterConfig();
check('scaffold starts as brandkit', cfg.brand.name, 'brandkit');
check('seeding reports that it acted', schema.seedBrandIdentity(cfg, tmp), true);
check('name comes from package.json', cfg.brand.name, 'barone-steel');
check('displayName is title-cased', cfg.brand.displayName, 'Barone Steel');
check('tagline is an explicit TODO', cfg.brand.tagline.indexOf('__TODO') === 0, true);
check('description is an explicit TODO', cfg.brand.description.indexOf('__TODO') === 0, true);
check('brandkit url is not shipped to a client', cfg.brand.url.indexOf('__TODO') === 0, true);
check("brandkit's wordmark is not shipped to a client", cfg.brand.sidebarLogo, '');

// Re-running must never clobber a real edit.
cfg.brand.name = 'edited-by-hand';
check('seeding is a no-op once customized', schema.seedBrandIdentity(cfg, tmp), false);
check('a hand edit survives', cfg.brand.name, 'edited-by-hand');

// brandkit's own repo must keep its scaffold defaults.
var selfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-self-'));
fs.writeFileSync(path.join(selfDir, 'package.json'), JSON.stringify({ name: '@stacklist-app/brandkit' }));
var selfCfg = schema.starterConfig();
check('brandkit does not reseed itself', schema.seedBrandIdentity(selfCfg, selfDir), false);

// A project with no package.json has nothing to seed from.
var bareDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-bare-'));
check('no package.json means no seeding', schema.seedBrandIdentity(schema.starterConfig(), bareDir), false);

// Tests must not leave artifacts behind.
[tmp, selfDir, bareDir].forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* already gone */ }
});

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
