/**
 * Chrome vs content: brandkit displays the brand, it does not wear it.
 *
 * The guide is three layers:
 *
 *   content  the document: prose, headings, swatches, specimens, demo
 *            surfaces. This is the brand, in the brand's colors and type.
 *   chrome   brandkit's own UI: sidebar, navigation, controls, toasts.
 *            Fixed tokens in the --bk- namespace. Reads NOTHING from the
 *            config, so a client's brand cannot repaint the tool.
 *   data     values the guide reports back: hex, oklch, type metrics,
 *            spacing steps, CSS. Measurements a reader copies, not copy to
 *            read, so they are monospace and chrome-colored.
 *
 * A Caslon brand used to set the whole navigation in Caslon and paint it in
 * the brand's greys. The rule now is absolute: no chrome rule may reference a
 * brand token, and this test is the enforcement.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var template = require('../lib/template');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = JSON.stringify(got) === JSON.stringify(want);
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
    (ok ? '' : '\n          got  ' + JSON.stringify(got) + '\n          want ' + JSON.stringify(want)));
  ok ? pass++ : fail++;
}

var root = path.join(__dirname, '..');
var css = fs.readFileSync(path.join(root, 'dist', 'styles.css'), 'utf8');

/* Every rule as { selectors, decls }. Comments are stripped from the selector
   capture because they live there: an earlier version of this scan silently
   skipped every rule that happened to follow a comment. */
function rules() {
  // Drop at-rule wrappers before scanning. The regex below pairs braces
  // without understanding nesting, so an @media/@supports opener would
  // swallow the first rule inside it: styles.css already has two such blocks
  // and both begin with a chrome rule.
  var flat = css.replace(/@(media|supports|layer|container|document)[^{]*\{/g, '');
  var out = [], re = /([^{}]+)\{([^}]*)\}/g, m;
  while ((m = re.exec(flat))) {
    var sels = m[1].replace(/\/\*[\s\S]*?\*\//g, '')
      .split(',').map(function (x) { return x.trim().replace(/\s+/g, ' '); }).filter(Boolean);
    if (!sels.length) continue;
    var decls = [];
    m[2].replace(/([-a-z]+)\s*:\s*([^;]+)/g, function (d, prop, value) {
      decls.push([prop, value.trim()]); return d;
    });
    out.push({ selectors: sels, decls: decls });
  }
  return out;
}
var ALL = rules();

function valueOf(selector, prop) {
  var v = '(unset)';
  ALL.forEach(function (r) {
    if (r.selectors.indexOf(selector) === -1) return;
    r.decls.forEach(function (d) { if (d[0] === prop) v = d[1]; });
  });
  return v;
}
function reads(value, token) { return value.indexOf('var(' + token + ')') !== -1; }

/* Any token a config can reach: every custom property except the --bk- ones,
   which is what the namespace is for. */
var BRAND_TOKEN = /var\(--(?!bk-)[a-zA-Z0-9-]+/;

/* ── Which rules are chrome ───────────────────────────────────────────── */
var CHROME = [
  /^\.sidebar($|[ .:-])/, /^\.nav-group/, /^\.copy-format-bar/, /^\.toast$/,
  /^\.copy-hint/, /^\.color-value/, /^\.type-tester-label select/,
  /^\.type-row-spec/, /^\.spacing-label/, /^\.spacing-value/,
  /^\.code-block/, /^\.changelog-empty code/, /^\.changelog-back/,
  /^\.hierarchy-hex/,
  /^\.logo-format-toggle/, /^\.logo-download-btn/, /^\.logo-size/,
  /^\.logo-card\.(bg|on)-light \.(logo-format-toggle|logo-size|logo-download)/
];
/* The logo card's own background is the brand surface a mark is displayed
   against, and .sidebar-logo is the client's actual logo file. Demos, not UI. */
var NOT_CHROME = [/^\.logo-card\.bg-light$/, /^\.sidebar-logo$/];

/* Split on top-level combinators only. A naive whitespace split cuts inside
   :not(...) and inside an attribute value, so `.content:not(.foo .sidebar)`
   read as chrome on the strength of a fragment that is not its subject.
   Contents of :is()/:not() stay inside their compound and are deliberately
   not treated as subjects: what a rule targets is what it is. */
function compounds(sel) {
  var out = [], buf = '', depth = 0, quote = null;
  for (var i = 0; i < sel.length; i++) {
    var ch = sel.charAt(i);
    // An escape takes the next character with it, in or out of a quote.
    // Peeking at sel[i-1] instead misreads `[data-x="a\\"]`, and letting an
    // escaped `\\[` count as a bracket leaves depth stuck above zero.
    if (ch === '\\') { buf += ch + sel.charAt(i + 1); i++; continue; }
    if (quote) { buf += ch; if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === '(' || ch === '[') { depth++; buf += ch; continue; }
    if (ch === ')' || ch === ']') { if (depth > 0) depth--; buf += ch; continue; }
    if (depth === 0 && /[\s>+~]/.test(ch)) { if (buf) { out.push(buf); buf = ''; } continue; }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

/* CHROME matches the whole selector OR any one compound: the whole selector
   so a pattern that spans a descendant (`.type-tester-label select`) still
   matches, any compound so a higher-specificity `.layout .sidebar` override
   is scanned rather than skipped.

   NOT_CHROME is tested against the whole selector or against the SUBJECT (the
   rightmost compound), never against every compound. Both its patterns are
   anchored and name a thing being displayed rather than UI: the client's own
   logo file, and the card surface a mark is shown against. What a rule
   targets is what it is, so `.sidebar .sidebar-logo` is still that logo.
   Testing per compound instead exempted every control inside a light logo
   card, which is the opposite of the intent. */
function isChromeSel(sel) {
  var parts = compounds(sel);
  var subject = parts[parts.length - 1] || sel;
  if (NOT_CHROME.some(function (r) { return r.test(sel) || r.test(subject); })) return false;
  if (CHROME.some(function (r) { return r.test(sel); })) return true;
  return parts.some(function (c) {
    return CHROME.some(function (r) { return r.test(c); });
  });
}

/* The classifier itself, pinned: a scan that quietly stops recognizing a
   selector reports zero leaks over zero rules and looks identical to a pass. */
[
  ['.sidebar', true],
  ['.layout .sidebar', true],                        // higher specificity, still chrome
  ['.type-tester-label select', true],               // pattern spans a descendant
  ['.changelog-empty code', true],
  ['.logo-card.bg-light .logo-format-toggle', true], // a control inside a demo card
  ['.logo-card.on-light .logo-download-btn', true],
  ['.sidebar-changelog:hover .sidebar-changelog-version', true],
  ['.logo-card.bg-light', false],                    // the demo surface itself
  ['.sidebar-logo', false],                          // the client's own mark
  ['.logo-card.on-light .logo-name', false],
  ['.type-sample-display', false],
  ['.color-name', false],
  ['body', false],
  ['.content:not(.foo .sidebar)', false],            // :not() contents are not the subject
  ['.sidebar .sidebar-logo', false],                 // the exempt target, one level in
  // The escape and bracket handling below: each of these was a rule that went
  // silently unscanned before round 3.
  ['.foo\\[x\\] .sidebar', true],                       // escaped bracket, depth must not stick
  ['[data-x="a\\\\"] .sidebar', true],                   // escaped backslash before the quote
  ['.a)))) .sidebar', true],                         // stray closers must not disable splitting
  ['.foo\\ .sidebar', false],                         // an escaped space is not a combinator
  ['.trailing\\', false]                              // an escape at the very end must not run off
].forEach(function (t) {
  check('classify ' + t[0] + ' as ' + (t[1] ? 'chrome' : 'content'), isChromeSel(t[0]), t[1]);
});

/* ── The rule: chrome reads nothing from the config ───────────────────── */
var chromeRules = ALL.filter(function (r) { return r.selectors.some(isChromeSel); });
check('the chrome scan still covers the stylesheet', chromeRules.length >= 45, true);
// The same list the count came from, so coverage and scanning cannot drift.
var leaks = [];
chromeRules.forEach(function (r) {
  r.decls.forEach(function (d) {
    if (BRAND_TOKEN.test(d[1])) leaks.push(r.selectors.join(', ') + ' { ' + d[0] + ': ' + d[1] + ' }');
  });
});
check('no chrome rule reads a brand token', leaks, []);

/* Spot checks, so a refactor that renames selectors still answers for these
   specific pieces of UI. */
[
  ['.sidebar', 'background', '--bk-ui-bg'],
  ['.sidebar', 'font-family', '--bk-ui-font'],
  ['.sidebar-brand', 'font-family', '--bk-ui-font'],   // the wordmark TEXT is UI
  ['.sidebar-brand', 'color', '--bk-ui-text'],
  ['.nav-group', 'color', '--bk-ui-text-muted'],
  ['.nav-group-items a.active', 'color', '--bk-ui-text'],
  ['.copy-format-bar button.active', 'background', '--bk-ui-selected'],
  ['.toast', 'background', '--bk-ui-text'],
  ['.type-tester-label select', 'color', '--bk-ui-text'],
  ['.logo-format-toggle button.active', 'background', '--bk-ui-selected-fg']  // inverts on dark cards
].forEach(function (t) {
  check('chrome ' + t[0] + ' ' + t[1] + ' is ' + t[2], reads(valueOf(t[0], t[1]), t[2]), true);
});

/* ── Data: monospace, chrome-colored ──────────────────────────────────── */
[
  '.color-value', '.hierarchy-hex', '.type-row-spec', '.spacing-label',
  '.spacing-value', '.a11y-ratio', '.code-block', '.changelog-empty code'
].forEach(function (sel) {
  check('data ' + sel + ' uses --bk-mono-font', reads(valueOf(sel, 'font-family'), '--bk-mono-font'), true);
});
check('data .color-value is chrome-colored', reads(valueOf('.color-value', 'color'), '--bk-ui-text-muted'), true);

/* One monospace stack, not several hardcoded ones. */
var hardcodedMono = [];
ALL.forEach(function (r) {
  r.decls.forEach(function (d) {
    if (d[0] === 'font-family' && /monospace/.test(d[1]) && !reads(d[1], '--bk-mono-font')) {
      hardcodedMono.push(r.selectors.join(', '));
    }
  });
});
check('no rule hardcodes its own monospace stack', hardcodedMono, []);

/* .a11y-ratio is the exception that proves the rule: it sits on a card whose
   colors ARE the subject (a contrast pair), so it inherits them and must not
   be forced to a chrome color. Monospace yes, chrome-colored no. */
check('.a11y-ratio inherits the pair it measures', valueOf('.a11y-ratio', 'color'), '(unset)');

/* ── Content: still the brand, or the guide displays nothing ──────────── */
[
  ['body', 'font-family', '--font-body'],
  ['body', 'background', '--cloud'],
  ['.header-wordmark', 'font-family', '--font-display'],
  ['.section-label', 'font-family', '--font-body'],
  ['.type-sample-display', 'font-family', '--font-display'],
  ['.type-sample-body', 'font-family', '--font-body'],
  ['.wordmark-box', 'font-family', '--font-display'],
  ['.logo-name', 'font-family', '--font-display'],
  ['.btn', 'font-family', '--font-body'],
  ['.changelog-title', 'font-family', '--font-display']
].forEach(function (t) {
  check('content ' + t[0] + ' ' + t[1] + ' keeps ' + t[2], reads(valueOf(t[0], t[1]), t[2]), true);
});

/* Swatch name and role are brand copy: only the value line moved. */
check('.color-name declares no font of its own', valueOf('.color-name', 'font-family'), '(unset)');
check('.color-role declares no font of its own', valueOf('.color-role', 'font-family'), '(unset)');
check('.color-name stays in the brand ink', reads(valueOf('.color-name', 'color'), '--ink'), true);

/* ── The tokens themselves ────────────────────────────────────────────── */
// EVERY :root block, in order, including a single-line one appended at the end
// of the file: a later re-declaration is what actually wins, and reading only
// taking the first match of the first block is the opposite of the cascade.
var baseline = (css.replace(/\/\*[\s\S]*?\*\//g, '').match(/:root\s*\{[^}]*\}/g) || []).join('\n');
function baselineValue(token) {
  var re = new RegExp(token + '\\s*:\\s*([^;]+)', 'g'), m, v = '(missing)';
  while ((m = re.exec(baseline))) v = m[1].trim();   // last one wins
  return v;
}
var REQUIRED = [
  '--bk-ui-font', '--bk-mono-font', '--bk-ui-bg', '--bk-ui-bg-subtle', '--bk-ui-bg-hover',
  '--bk-ui-border', '--bk-ui-border-strong', '--bk-ui-text', '--bk-ui-text-rgb',
  '--bk-ui-text-muted', '--bk-ui-text-subtle', '--bk-ui-selected', '--bk-ui-selected-fg',
  '--bk-ui-code-bg', '--bk-ui-code-text'
];
var missing = REQUIRED.filter(function (t) { return baselineValue(t) === '(missing)'; });
check('every chrome token has a baseline value', missing, []);

// Derived, not typed, so a --bk- token added later is checked without anyone
// remembering to list it here.
var TOKENS = (baseline.match(/--bk-[a-zA-Z0-9-]+(?=\s*:)/g) || [])
  .filter(function (t, i, a) { return a.indexOf(t) === i; });
check('the declared chrome tokens include every required one',
  REQUIRED.filter(function (t) { return TOKENS.indexOf(t) === -1; }), []);

/* A chrome token defined in terms of a brand token would reintroduce the whole
   problem one level down. */
var derived = TOKENS.filter(function (t) { return /var\(/.test(baselineValue(t)); });
check('no chrome token is derived from another token', derived, []);

check('--bk-ui-font is never serif', /serif/.test(baselineValue('--bk-ui-font').replace(/sans-serif/g, '')), false);
check('--bk-mono-font is a monospace stack', /monospace/.test(baselineValue('--bk-mono-font')), true);

/* ── Chrome contrast: a palette nobody can override is a palette that has
      to be right on its own. Both failures this pins were introduced by the
      token swap: text-subtle at 2.5:1, and a selected chip the same ink as
      the card it sits on. ─────────────────────────────────────────────── */
function luminance(hex) {
  var c = hex.replace('#', '').match(/../g).map(function (x) {
    var v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  var l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function tok(name) { return baselineValue(name).replace(/\s*\/\*[\s\S]*$/, '').trim(); }

[
  ['--bk-ui-text', '--bk-ui-bg', 4.5],
  ['--bk-ui-text-muted', '--bk-ui-bg', 4.5],
  ['--bk-ui-text-muted', '--bk-ui-bg-subtle', 4.5],
  ['--bk-ui-text-subtle', '--bk-ui-bg', 4.5],
  ['--bk-ui-selected-fg', '--bk-ui-selected', 4.5],
  ['--bk-ui-code-text', '--bk-ui-code-bg', 4.5],
  ['--bk-ui-border-strong', '--bk-ui-bg', 3]      // a control boundary, 1.4.11
].forEach(function (t) {
  var got = contrast(tok(t[0]), tok(t[1]));
  check(t[0] + ' on ' + t[1] + ' >= ' + t[2] + ':1 (' + got.toFixed(2) + ')', got >= t[2], true);
});

/* The selected format chip sits on the logo card, whose default dark surface
   is the brand's --ink. Its fill must not be the same ink as --bk-ui-selected,
   which is what made it a 1.00:1 pill. */
check('the selected chip inverts on dark cards',
  reads(valueOf('.logo-format-toggle button.active', 'background'), '--bk-ui-selected-fg'), true);

/* ── The reserved namespace, enforced at build and at runtime ─────────── */
check('isChromeToken flags --bk-*', template.isChromeToken('--bk-ui-bg'), true);
check('isChromeToken passes brand tokens', template.isChromeToken('--accent'), false);
check('isChromeToken is not fooled by a lookalike', template.isChromeToken('--bkgd'), false);
// cssValue() strips <>{}; AFTER this test runs, so a key that is not --bk-*
// as authored can be --bk-* as emitted.
check('isChromeToken sees through the sanitizer', template.isChromeToken('--b;k-mono-font'), true);
check('isChromeToken sees through a brace', template.isChromeToken('--b{k-ui-bg'), true);

var hostile = {
  theme: {
    '--accent': '#171D3A',
    '--bk-ui-font': "'Kings Caslon Display', serif",
    '--bk-ui-bg': '#1C1C1E'
  },
  fonts: { body: { family: 'Adobe Caslon Pro', fallback: 'EB Garamond' } }
};
var generated = template.generateRootCSS(hostile);
check('build drops --bk-* keys from theme', /--bk-/.test(generated), false);
check('build keeps the brand tokens beside them', generated.indexOf('--accent: #171D3A') !== -1, true);

var exporter = require('../lib/export');
var tokens = exporter.buildTokensJson({
  brand: { name: 'x' },
  theme: { '--accent': '#171D3A', '--BK-UI-BG': '#1C1C1E', '--b;k-ui-text': '#FF0000' }
});
check('tokens.json carries no chrome token', /bk-ui/i.test(JSON.stringify(tokens)), false);
check('tokens.json still carries the brand', /171D3A/i.test(JSON.stringify(tokens)), true);

/* Three copies of this guard exist (build, engine, changelog page) and they
   have to agree exactly: a config that previews one way and builds another is
   the failure this namespace is supposed to make impossible. Extract each
   runtime copy and run it against the same table as the build's, rather than
   checking that the file mentions the function. */
var GUARD_CASES = [
  ['--accent', false], ['--ink', false], ['--bkgd', false], ['--bk', false],
  ['', false], [null, false], [undefined, false], [{}, false],
  ['--bk-ui-bg', true], ['--BK-UI-BG', true], ['  --bk-x', true],
  ['--b;k-mono-font', true],      // the value sanitizer would make this reserved
  ['/**/--bk-ui-bg', true],       // CSS drops the comment, the browser reads it as reserved
  ['/* */ --bk-ui-text', true]
];

function extractGuard(src, file) {
  // Both are one-liners in dist/, so take whole lines: a brace-counting
  // extractor trips over the { } inside their own character classes.
  function lineWith(needle) {
    var hit = src.split('\n').filter(function (l) { return l.indexOf(needle) !== -1; })[0];
    if (!hit) throw new Error('could not find ' + needle + ' in ' + file);
    return hit.trim();
  }
  // cssKey feeds isChromeToken, so both come across together.
  return new Function(lineWith('function cssKey(k)') + '\n' +
                      lineWith('function isChromeToken(key)') + '\n' +
                      'return isChromeToken;')();
}

['engine.js', 'changelog.js'].forEach(function (f) {
  var runtime = extractGuard(fs.readFileSync(path.join(root, 'dist', f), 'utf8'), f);
  var disagreements = GUARD_CASES.filter(function (c) {
    return runtime(c[0]) !== c[1] || template.isChromeToken(c[0]) !== c[1];
  }).map(function (c) { return String(c[0]); });
  check(f + "'s guard agrees with the build's, case for case", disagreements, []);
});

/* And the guard has to be wired into the injection, not merely present. */
['engine.js', 'changelog.js'].forEach(function (f) {
  var js = fs.readFileSync(path.join(root, 'dist', f), 'utf8');
  check(f + ' filters the injected theme through it', /isChromeToken\((keys\[i\]|k)\)/.test(js), true);
  check(f + ' emits property names through cssKey', /cssKey\(keys\[i\]\)/.test(js), true);
});

/* ── The contract agents are handed ───────────────────────────────────── */
var agents = require('../lib/agents-doc').agentsDoc();
check('AGENTS.md states the chrome rule', /## The chrome is not the brand/.test(agents), true);
check('AGENTS.md names the reserved namespace', /`--bk-\*` is a reserved namespace/.test(agents), true);

/* The contract has to reach guides that already exist, or the rule only ever
   applies to brands installed after it was written. */
var init = require('../cli/init');
var quiet = console.log; console.log = function () {};
var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-chrome-'));
var agentsPath = path.join(dir, 'AGENTS.md');
init([dir]);
fs.writeFileSync(agentsPath, '# a guide scaffolded before the rule existed\n');
init([dir, '--update']);
var refreshed = fs.readFileSync(agentsPath, 'utf8');
init(['--update', dir]);   // flag first: used to scaffold into a dir named --update
var flagFirst = fs.readFileSync(agentsPath, 'utf8');
fs.writeFileSync(agentsPath, '# hand written\n');
init([dir]);
var untouched = fs.readFileSync(agentsPath, 'utf8');
console.log = quiet;

check('init --update refreshes a stale AGENTS.md', /## The chrome is not the brand/.test(refreshed), true);
check('--update before the dir names the dir, not a folder', flagFirst, refreshed);
check('plain init keeps an existing AGENTS.md', untouched, '# hand written\n');
check('no directory named --update was created', fs.existsSync(path.join(process.cwd(), '--update')), false);
fs.rmSync(dir, { recursive: true, force: true });

console.log('\n  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
