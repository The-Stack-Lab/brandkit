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

// Short and alpha hex forms. A 4-digit value is #RGBA and an 8-digit one is
// #RRGGBBAA; parsing either as a plain integer silently yields a DIFFERENT
// color (#AABBCCDD once read as #BBCCDD, because the 8-digit parse overflows
// 2^31 and `>>` then works on a negative signed value).
check('#RGB expands', helpers.parseCssColor('#ABC').hex, '#AABBCC');
check('#RGBA drops alpha, keeps the color', helpers.parseCssColor('#ABCD').hex, '#AABBCC');
check('#RRGGBB is identity', helpers.parseCssColor('#AABBCC').hex, '#AABBCC');
check('#RRGGBBAA drops alpha, keeps the color', helpers.parseCssColor('#AABBCCDD').hex, '#AABBCC');
check('opaque white with alpha', helpers.parseCssColor('#FFFFFFFF').hex, '#FFFFFF');
check('invalid hex digits are rejected', helpers.parseCssColor('#GGG'), null);

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

// An unmeasurable pair must contribute no row at all. `rating !== 'Fail'` was
// true for null, which published {ratio: null, rating: null} into the guide's
// accessibility table as though it had been measured.
var a11y = helpers.generateA11yPairs([{ hex: 'var(--x)', name: 'Broken' }, { hex: '#000000', name: 'Ink' }]);
check('unmeasurable color contributes no a11y rows', a11y.length, 2);
check('no null ratio reaches the a11y table',
  a11y.some(function (p) { return p.ratio === null || p.rating === null; }), false);

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

// package.json is untrusted — brandkit may run inside a repo someone else
// wrote, and this value is rendered into the guide and written to brand.md.
var evilDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-evil-'));
fs.writeFileSync(path.join(evilDir, 'package.json'),
  JSON.stringify({ name: 'evil<img src=x onerror=alert(1)>' }));
var evilCfg = schema.starterConfig();
schema.seedBrandIdentity(evilCfg, evilDir);
check('markup is stripped from a seeded name',
  /[<>]/.test(evilCfg.brand.name + evilCfg.brand.displayName), false);

var longDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-long-'));
fs.writeFileSync(path.join(longDir, 'package.json'),
  JSON.stringify({ name: new Array(501).join('a') }));
var longCfg = schema.starterConfig();
schema.seedBrandIdentity(longCfg, longDir);
check('an absurdly long name is bounded', longCfg.brand.name.length <= 64, true);

var ctrlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-ctrl-'));
fs.writeFileSync(path.join(ctrlDir, 'package.json'),
  JSON.stringify({ name: 'ab' + String.fromCharCode(10) + 'cd' + String.fromCharCode(7) }));
var ctrlCfg = schema.starterConfig();
schema.seedBrandIdentity(ctrlCfg, ctrlDir);
check('control characters are stripped',
  /[\x00-\x1F\x7F]/.test(ctrlCfg.brand.name), false);

[evilDir, longDir, ctrlDir].forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* already gone */ }
});

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
// Mark it as a repo root so the upward walk stops here. Without a boundary the
// assertion would depend on whatever happens to sit above TMPDIR — which on CI
// is often inside a checkout that does have a package.json.
fs.mkdirSync(path.join(bareDir, '.git'));
check('no package.json means no seeding', schema.seedBrandIdentity(schema.starterConfig(), bareDir), false);

// Tests must not leave artifacts behind.
[tmp, selfDir, bareDir].forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* already gone */ }
});

/* ------------------------------------------------------------------ *
 * 9. Ensemble-review findings (PR #12)
 * ------------------------------------------------------------------ */

// Quoted values are data, not structure. A brace inside a string closed the
// block early and dropped every declaration after it (all of them, in fact).
check('brace inside a quoted value does not close the block',
  I.extractFromContent(':root { --text: "}"; --accent: #fff; }')['--accent'], '#fff');
check('the quoted value itself survives',
  I.extractFromContent(':root { --text: "}"; --accent: #fff; }')['--text'], '"}"');
check('a comment opener inside a string is not a comment',
  I.extractFromContent(':root { --q: "/* x */"; --a: #111; }')['--a'], '#111');

// Parens and commas inside a quoted fallback were counted as structure and
// rewrote the value into confident nonsense ("foobar")).
check('paren inside a quoted fallback is preserved',
  I.resolveVarRefs({ '--x': 'var(--missing, "foo)bar")' })['--x'], '"foo)bar"');

// A fallback only counts if it resolves completely.
check('unresolved nested fallback stays exactly as authored',
  I.resolveVarRefs({ '--x': 'var(--missing, var(--also-missing))' })['--x'],
  'var(--missing, var(--also-missing))');
check('resolvable nested fallback still resolves',
  I.resolveVarRefs({ '--b': '#123456', '--x': 'var(--missing, var(--b))' })['--x'], '#123456');

// CSS angle units. Stripping only "deg" read `0.5turn` as 0.5 degrees — red
// where the author wrote cyan.
check('turn is converted', helpers.parseCssColor('hsl(0.5turn 100% 50%)').hex, '#00FFFF');
check('grad is converted', helpers.parseCssColor('hsl(200grad 100% 50%)').hex, '#00FFFF');
check('rad is converted', helpers.parseCssColor('hsl(3.14159265rad 100% 50%)').hex, '#00FFFF');
check('deg is unchanged', helpers.parseCssColor('hsl(180deg 100% 50%)').hex, '#00FFFF');
check('a bare number is degrees', helpers.parseCssColor('hsl(180 100% 50%)').hex, '#00FFFF');
check('an unknown angle unit is rejected', helpers.parseCssColor('hsl(10px 100% 50%)'), null);

// A keyword has no function head, so splitting on '(' returned the keyword.
check('named color reports colorSpace "named"', helpers.parseCssColor('white').space, 'named');
check('oklch still reports its own space', helpers.parseCssColor('oklch(0.5 0.1 200)').space, 'oklch');

// The authored value must survive whenever it differs from the emitted hex —
// an alpha hex included, since its transparency is dropped.
var alphaTokens = exporter.buildTokensJson({
  brand: { name: 'x' },
  theme: { '--overlay': '#00000080', '--paper': 'white', '--ink': '#111827' }
});
check('alpha hex keeps its authored value',
  alphaTokens.color.overlay.$extensions['app.stacklist.brandkit'].authored, '#00000080');
check('named color keeps its authored value',
  alphaTokens.color.paper.$extensions['app.stacklist.brandkit'].authored, 'white');
check('a plain hex still carries no extensions', alphaTokens.color.ink.$extensions, undefined);

// A family read off a next/font variable is a guess: --font-geist-sans is the
// family "Geist". Publishing a googleImport for it ships an @import that 404s.
var inferredFonts = extractCSS.fontsFromVars({ '--font-sans': 'var(--font-geist-sans)' });
check('a var-derived family is flagged inferred', inferredFonts.body.inferred, true);
var literalFonts = extractCSS.fontsFromVars({ '--font-sans': "'Inter', sans-serif" });
check('a literal family is not flagged inferred', literalFonts.body.inferred, false);

// Identity seeding is per-field: a hand edit must survive even while
// brand.name is still the scaffold value.
var editDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-edit-'));
fs.writeFileSync(path.join(editDir, 'package.json'), JSON.stringify({ name: 'acme-corp' }));
var edited = schema.starterConfig();
edited.brand.tagline = 'We forge steel beams.';
edited.brand.sidebarLogo = 'logos/acme.svg';
schema.seedBrandIdentity(edited, editDir);
check('seeding fills the untouched name', edited.brand.name, 'acme-corp');
check('a hand-written tagline survives seeding', edited.brand.tagline, 'We forge steel beams.');
check('a hand-set logo is not reset to empty', edited.brand.sidebarLogo, 'logos/acme.svg');

// The guide dir is a child of the project it documents, so seeding must walk
// up — not read the process cwd, which named a monorepo package after the root.
var monoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-mono-'));
fs.mkdirSync(path.join(monoRoot, 'packages', 'client', 'brand'), { recursive: true });
fs.writeFileSync(path.join(monoRoot, 'package.json'), JSON.stringify({ name: 'monorepo-root' }));
fs.writeFileSync(path.join(monoRoot, 'packages', 'client', 'package.json'),
  JSON.stringify({ name: 'client-app' }));
var monoCfg = schema.starterConfig();
schema.seedBrandIdentity(monoCfg, path.join(monoRoot, 'packages', 'client', 'brand'));
check('seeding walks up to the owning package', monoCfg.brand.name, 'client-app');

[editDir, monoRoot].forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* already gone */ }
});

/* ------------------------------------------------------------------ *
 * 10. Second-round ensemble findings (PR #12)
 * ------------------------------------------------------------------ */

// A CSS string cannot span lines. One unterminated quote used to put the whole
// remainder of the file "inside a string", which stopped comment stripping and
// handed a commented-out — deliberately disabled — declaration to the parser
// as live. Ordered so that "last write wins" cannot mask the failure.
var unterminated = '.a { content: "oops;\n}\n:root { --brand: #0000ff; /* --brand: #ff0000; */ }';
check('a disabled declaration never beats the live one',
  I.extractFromContent(unterminated)['--brand'], '#0000ff');
check('a commented-out token does not leak in',
  '--y' in I.extractFromContent('.a { content: "oops;\n}\n:root { --x: #111; /* --y: #222; */ }'), false);

// Escapes outside a string hide the next character from the scanner too.
check('an escaped brace does not close the block',
  I.extractFromContent(':root { --text: \\}; --accent: #fff; }')['--accent'], '#fff');
// The escaped `)` must not be read as the closing paren: the fallback is the
// whole `foo\)bar`, not the truncated `foo\` the old scanner produced.
check('an escaped paren does not truncate the fallback',
  I.resolveVarRefs({ '--x': 'var(--missing, foo\\)bar)' })['--x'], 'foo\\)bar');
// The quoted forms must keep working.
check('a quoted brace still does not close the block',
  I.extractFromContent(':root { --t: "}"; --a: #fff; }')['--a'], '#fff');

// A family read off a next/font variable names the binding, not the typeface.
// It must not ship a Google Fonts import, and it must say where it came from.
var inferred = extractCSS.fontsFromVars({ '--font-sans': 'var(--font-geist-sans)' });
check('the source variable is recorded', inferred.body.source, '--font-geist-sans');
check('a literal family records no source',
  extractCSS.fontsFromVars({ '--font-sans': "'Inter', sans-serif" }).body.source, null);

// Seeding must not wander out of the project.
var repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-repo-'));
fs.mkdirSync(path.join(repoDir, '.git'));
fs.mkdirSync(path.join(repoDir, 'brand'));
check('the walk stops at a repo root with no package.json',
  schema.seedBrandIdentity(schema.starterConfig(), path.join(repoDir, 'brand')), false);
fs.writeFileSync(path.join(repoDir, 'package.json'), JSON.stringify({ name: 'in-repo-app' }));
var repoCfg = schema.starterConfig();
schema.seedBrandIdentity(repoCfg, path.join(repoDir, 'brand'));
check('a package.json at the repo root is still found', repoCfg.brand.name, 'in-repo-app');

// An author-cleared field is a decision, not an empty slot to refill.
var clearedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-cleared-'));
fs.writeFileSync(path.join(clearedDir, 'package.json'), JSON.stringify({ name: 'acme' }));
var cleared = schema.starterConfig();
cleared.brand.tagline = '';
schema.seedBrandIdentity(cleared, clearedDir);
check('a deliberately emptied field stays empty', cleared.brand.tagline, '');
check('the name is still seeded alongside it', cleared.brand.name, 'acme');

// An absent name is as unseeded as the scaffold value. Assert the NAME, not
// just the return value: this originally passed while brand.name stayed ''
// because the other identity fields had changed and flipped the flag.
var namelessCfg = schema.starterConfig();
namelessCfg.brand.name = '';
schema.seedBrandIdentity(namelessCfg, clearedDir);
check('an empty name is actually seeded', namelessCfg.brand.name, 'acme');

[repoDir, clearedDir].forEach(function (d) {
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* already gone */ }
});

/* ------------------------------------------------------------------ *
 * 11. Third-round ensemble findings (PR #12)
 * ------------------------------------------------------------------ */

// CSS treats CR and CRLF as newlines too. Checking only \n left a CR-only or
// CRLF stylesheet "inside a string" for the rest of the file, so a
// commented-out declaration was parsed as live.
['\n', '\r', '\r\n'].forEach(function (nl) {
  var label = nl === '\n' ? 'LF' : (nl === '\r' ? 'CR' : 'CRLF');
  var css = '.a { content: "oops;' + nl + '}' + nl +
            ':root { --brand: #0000ff; /* --brand: #ff0000; */ }';
  check('unterminated string recovers on ' + label,
    I.extractFromContent(css)['--brand'], '#0000ff');
});

// The home boundary must be tested BEFORE its own manifest, or the walk
// returns the very ~/package.json it exists to reject.
var homeWalk = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-home-'));
fs.writeFileSync(path.join(homeWalk, 'package.json'), JSON.stringify({ name: 'stray-home-pkg' }));
fs.mkdirSync(path.join(homeWalk, 'brand'));
// Not the real home, so this asserts the ordering via the .git boundary
// instead: a manifest at a repo root is still found, one above it is not.
fs.mkdirSync(path.join(homeWalk, 'repo', 'brand'), { recursive: true });
fs.mkdirSync(path.join(homeWalk, 'repo', '.git'), { recursive: true });
check('the walk does not climb past a repo root to an outer manifest',
  schema.seedBrandIdentity(schema.starterConfig(), path.join(homeWalk, 'repo', 'brand')), false);
try { fs.rmSync(homeWalk, { recursive: true, force: true }); } catch (_) { /* already gone */ }

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
