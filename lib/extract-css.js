var fs = require('fs');
var path = require('path');

/**
 * Extract CSS custom properties from CSS files in a project.
 * Looks for :root blocks and @theme blocks (Tailwind v4, incl. modifiers).
 */
function extract(projectDir) {
  var cssFiles = findCSSFiles(projectDir);
  var allVars = {};

  for (var i = 0; i < cssFiles.length; i++) {
    var content = fs.readFileSync(cssFiles[i], 'utf8');
    var vars = extractFromContent(content);
    var keys = Object.keys(vars);
    for (var j = 0; j < keys.length; j++) {
      allVars[keys[j]] = vars[keys[j]];
    }
  }

  if (!Object.keys(allVars).length) return null;

  // Resolve var() aliases only once every file has been read: a token ladder
  // (`--primary: var(--brand)`) routinely spans files, so resolving per-file
  // would leave cross-file references stranded as literals.
  return resolveVarRefs(allVars);
}

function findCSSFiles(dir) {
  var results = [];
  var searchDirs = [
    path.join(dir, 'src'),
    path.join(dir, 'app'),
    path.join(dir, 'styles'),
    dir
  ];

  for (var i = 0; i < searchDirs.length; i++) {
    if (!fs.existsSync(searchDirs[i])) continue;
    scanDir(searchDirs[i], results, 0);
  }
  return results;
}

/**
 * A brandkit guide directory ships its own `styles.css` whose `:root` block
 * declares defaults for every token the stylesheet consumes — including the
 * placeholder indigo accent and gradient. Scanning it would read brandkit's
 * own scaffold back as if it were the host project's brand, so a guide that
 * lives inside the scanned tree (the documented layout) would keep
 * regenerating the placeholders it is supposed to replace.
 */
function isGuideDir(dir) {
  return fs.existsSync(path.join(dir, 'engine.js')) &&
         fs.existsSync(path.join(dir, 'styles.css'));
}

function scanDir(dir, results, depth) {
  if (depth > 3) return; // Don't go too deep
  if (isGuideDir(dir)) return;
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_) {
    return;
  }

  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
      scanDir(fullPath, results, depth + 1);
    } else if (entry.isFile() && entry.name.endsWith('.css')) {
      results.push(fullPath);
    }
  }
}

/**
 * CSS treats LF, CR, CRLF and form feed alike as newlines, and a newline ends
 * an unterminated string. Checking only \n let a CR-only or CRLF file keep the
 * scanner "inside a string" for the rest of the file.
 */
function isNewline(c) {
  return c === '\n' || c === '\r' || c === '\f';
}

/**
 * Strip CSS comments so a brace inside one cannot unbalance the block reader
 * below. Offsets need not be preserved — callers only read declarations out of
 * the result, never positions.
 */
function stripComments(css) {
  var out = '';
  var quote = null;
  var i = 0;
  var n = css.length;

  while (i < n) {
    var c = css.charAt(i);

    if (quote) {
      // A CSS string cannot span lines. Without this, one unterminated quote
      // put the whole rest of the file "inside a string", comment stripping
      // stopped, and a commented-out `--brand: #ff0000` was handed to the
      // declaration parser as live — a disabled value winning over the real one.
      if (isNewline(c)) { quote = null; out += c; i++; continue; }
      out += c;
      if (c === '\\' && i + 1 < n) {
        // `\` + CRLF is one line continuation, not an escape of CR followed by
        // a bare LF that would then close the string.
        if (css.charAt(i + 1) === '\r' && css.charAt(i + 2) === '\n') {
          out += '\r\n'; i += 3; continue;
        }
        out += css.charAt(i + 1); i += 2; continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }

    // An escape outside a string hides the next character from the scanner too
    // (`--text: \/*literal` is not a comment opener).
    if (c === '\\' && i + 1 < n) { out += c + css.charAt(i + 1); i += 2; continue; }

    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }

    // A comment opener inside a quoted value is literal text, not a comment —
    // hence the quote tracking above.
    if (c === '/' && css.charAt(i + 1) === '*') {
      var end = css.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      out += ' '; // keep tokens either side from fusing
      continue;
    }

    out += c;
    i++;
  }
  return out;
}

/**
 * Read the balanced `{ … }` body that follows each match of `headRe`.
 *
 * The previous implementation used `\{([^}]+)\}`, which stops at the FIRST
 * closing brace — so any nested at-rule or rule inside the block truncated
 * everything after it. Brace counting reads the whole block instead.
 *
 * `headRe` must be global and must match through its opening brace.
 */
function matchBlocks(content, headRe) {
  var blocks = [];
  var m;
  headRe.lastIndex = 0;
  while ((m = headRe.exec(content)) !== null) {
    var start = m.index + m[0].length; // first char after '{'
    var depth = 1;
    var i = start;
    var quote = null;
    while (i < content.length && depth > 0) {
      var ch = content.charAt(i);
      // A brace inside a quoted value (`--x: "}"`) is data, not structure.
      // Counting it closed the block early and silently dropped every
      // declaration that followed.
      if (quote) {
        if (isNewline(ch)) { quote = null; i++; continue; } // strings don't span lines
        if (ch === '\\') {
          i += (content.charAt(i + 1) === '\r' && content.charAt(i + 2) === '\n') ? 3 : 2;
          continue;
        }
        if (ch === quote) quote = null;
        i++;
        continue;
      }
      if (ch === '\\') { i += 2; continue; } // `\}` is data, not a closing brace
      if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      i++;
    }
    if (depth !== 0) break; // unbalanced — stop rather than mis-read the rest
    blocks.push(content.slice(start, i - 1));
    headRe.lastIndex = i;
  }
  return blocks;
}

function extractFromContent(content) {
  var vars = {};
  var css = stripComments(content);
  var i;

  // :root { ... }
  var rootBlocks = matchBlocks(css, /:root\s*\{/g);
  for (i = 0; i < rootBlocks.length; i++) parseVarBlock(rootBlocks[i], vars);

  // @theme { ... } / @theme inline { ... } / @theme static { ... }
  //
  // Tailwind v4 allows a modifier between the at-rule and its block, and
  // `npx shadcn init` writes `@theme inline {`. Matching only `@theme\s*\{`
  // made that entire block — every font token, the type scale, the semantic
  // color aliases — invisible to `generate` on a stock shadcn project.
  var themeBlocks = matchBlocks(css, /@theme(?:\s+[\w-]+)*\s*\{/g);
  for (i = 0; i < themeBlocks.length; i++) parseVarBlock(themeBlocks[i], vars);

  return vars;
}

function parseVarBlock(block, vars) {
  var lineRegex = /(--[\w-]+)\s*:\s*([^;]+);/g;
  var match;
  while ((match = lineRegex.exec(block)) !== null) {
    vars[match[1].trim()] = match[2].trim();
  }
}

/* ------------------------------------------------------------------ *
 * var() resolution
 * ------------------------------------------------------------------ */

var MAX_VAR_DEPTH = 10;

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/**
 * Locate the next `var(…)` at or after `from`, paren-matched.
 *
 * A regex cannot do this: a fallback may itself contain parentheses
 * (`var(--a, oklch(0.36 0.15 269))`, or a nested `var(--b)`), so any
 * character-class bound either stops at the wrong `)` or refuses to match.
 * Counting parens finds the true extent, and splitting on the first
 * top-level comma separates the name from its fallback.
 *
 * Returns { start, end, name, fallback } with `name` null when the text is
 * not a well-formed custom-property reference, so the caller can skip it.
 */
function findVar(v, from) {
  var idx = v.indexOf('var(', from);
  if (idx === -1) return null;

  // Parentheses and commas inside a quoted fallback (`var(--a, "foo)bar")`)
  // are data. Counting them closed the reference at the wrong `)` and
  // rewrote the value into confident nonsense.
  var i = idx + 4;
  var depth = 1;
  var quote = null;
  while (i < v.length && depth > 0) {
    var ch = v.charAt(i);
    if (quote) {
      if (isNewline(ch)) { quote = null; i++; continue; }
      if (ch === '\\') {
        i += (v.charAt(i + 1) === '\r' && v.charAt(i + 2) === '\n') ? 3 : 2;
        continue;
      }
      if (ch === quote) quote = null;
      i++;
      continue;
    }
    if (ch === '\\') { i += 2; continue; } // `\)` is data, not the closing paren
    if (ch === '"' || ch === "'") { quote = ch; i++; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    i++;
  }
  if (depth !== 0) return null; // unterminated — nothing further is parseable

  var inner = v.slice(idx + 4, i - 1);
  var d = 0;
  var comma = -1;
  var q = null;
  for (var j = 0; j < inner.length; j++) {
    var c = inner.charAt(j);
    if (q) {
      if (isNewline(c)) { q = null; continue; }
      if (c === '\\') { j += (inner.charAt(j + 1) === '\r' && inner.charAt(j + 2) === '\n') ? 2 : 1; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '\\') { j++; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(') d++;
    else if (c === ')') d--;
    else if (c === ',' && d === 0) { comma = j; break; }
  }

  var name = (comma === -1 ? inner : inner.slice(0, comma)).trim();
  var fallback = comma === -1 ? undefined : inner.slice(comma + 1).trim();
  return {
    start: idx,
    end: i,
    name: /^--[\w-]+$/.test(name) ? name : null,
    fallback: fallback
  };
}

/**
 * Resolve a single custom property to a literal value.
 * Returns null when it cannot be resolved (missing, cyclic, or too deep) so
 * the caller can keep the authored text rather than invent a value.
 */
function resolveName(name, vars, chain, depth) {
  if (depth > MAX_VAR_DEPTH) return null;
  if (chain.indexOf(name) !== -1) return null; // cycle
  if (!hasOwn(vars, name)) return null;

  var out = expand(vars[name], vars, chain.concat([name]), depth);
  // Substitute only what resolves *completely*. A half-expanded value is
  // worse than the original: `--a: var(--b)` / `--b: var(--a)` would otherwise
  // surface as `--a: var(--a)`, which reads as a self-reference the author
  // never wrote. Reporting it as unresolvable keeps the authored text.
  if (/var\(\s*--/.test(out)) return null;
  return out;
}

/**
 * Substitute every resolvable var() inside a declaration value.
 * Unresolvable references are left exactly as authored.
 */
function expand(value, vars, chain, depth) {
  var v = String(value);
  if (depth > MAX_VAR_DEPTH) return v;

  var from = 0;
  var guard = 0;
  while (guard++ < 200) {
    var f = findVar(v, from);
    if (!f) break;
    if (f.name === null) { from = f.end; continue; } // malformed — leave as authored

    // Outermost-first: `var(--gone, var(--brand))` takes the fallback branch
    // whole, and expanding that fallback resolves the inner reference. The
    // result is fully expanded, so scanning can continue past it.
    var resolved = resolveName(f.name, vars, chain, depth + 1);
    if (resolved === null && f.fallback !== undefined) {
      // The fallback only counts if it resolves completely. Substituting a
      // partially-expanded one turned `var(--missing, var(--also-missing))`
      // into `var(--also-missing)` — a value the author never wrote, and a
      // breach of the same keep-authored contract resolveName() enforces.
      var viaFallback = expand(f.fallback, vars, chain, depth + 1);
      resolved = /var\(\s*--/.test(viaFallback) ? null : viaFallback;
    }
    if (resolved === null) {
      from = f.end; // unresolvable — leave it literal and keep scanning
      continue;
    }
    v = v.slice(0, f.start) + resolved + v.slice(f.end);
    from = f.start + resolved.length;
  }
  return v;
}

/**
 * Dereference var() across the whole collected map.
 *
 * A shadcn theme is normally written as a token ladder
 * (`--brand: oklch(…)` / `--primary: var(--brand)`). Storing the alias
 * verbatim pushed the literal string `var(--brand)` all the way into the
 * client-facing brand.md as prose.
 */
function resolveVarRefs(vars) {
  var out = {};
  var keys = Object.keys(vars);
  for (var i = 0; i < keys.length; i++) {
    out[keys[i]] = expand(vars[keys[i]], vars, [keys[i]], 0);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Mapping onto brandkit theme tokens
 * ------------------------------------------------------------------ */

/**
 * shadcn/Tailwind name → brandkit token.
 *
 * Every destination appears exactly once. The previous table sent
 * `--secondary`, `--muted` AND `--border` all to `--mist`, so whichever was
 * parsed last silently overwrote the other two.
 *
 * `--mist` is brandkit's hairline color (styles.css uses it in 21 border
 * declarations vs 7 backgrounds), so `--border` is its rightful owner.
 * Anything absent from this table passes through under its own name, so an
 * unmapped token such as `--secondary` is carried into the config intact
 * rather than dropped.
 */
var THEME_MAPPING = {
  '--background': '--cloud',
  '--foreground': '--ink',
  '--primary': '--accent',
  // A foreground must follow its fill. `--primary` becomes brandkit's accent,
  // so `--primary-foreground` — the colour shadcn puts ON that fill — becomes
  // `--accent-foreground`.
  '--primary-foreground': '--accent-foreground',
  '--muted': '--haze',
  '--muted-foreground': '--slate',
  '--accent': '--coral',
  // shadcn's own `--accent` is a hover/tint surface, remapped to `--coral`.
  // Its foreground therefore belongs to `--coral`, and brandkit has no
  // `--coral-foreground` token. Passing it through would land it in
  // `--accent-foreground`, where it reads as "text on the brand accent" — a
  // different colour's partner. With `--primary-foreground` now claiming that
  // slot, passing it through would also collide, resolved by whichever the
  // stylesheet happened to declare first. Dropped instead: no home, no guess.
  '--accent-foreground': null,
  '--destructive': '--error',
  '--border': '--mist'
};

// Sources whose destination is null are deliberately dropped, not mapped.
// Every non-null destination must be unique — two sources sharing one is the
// silent-overwrite bug this table was rewritten to remove. Asserted at load so
// a future edit cannot reintroduce it unnoticed.
(function assertOneToOne() {
  var seen = {};
  Object.keys(THEME_MAPPING).forEach(function (src) {
    var dest = THEME_MAPPING[src];
    if (dest === null) return;
    if (seen[dest]) {
      throw new Error('brandkit: THEME_MAPPING is not 1:1 — ' + seen[dest] +
        ' and ' + src + ' both map to ' + dest);
    }
    seen[dest] = src;
  });
})();

function mapToTheme(cssVars, opts) {
  if (!cssVars) return null;
  opts = opts || {};
  var warn = opts.warn;

  var theme = {};
  var claimedBy = {}; // destination token → source that claimed it
  var keys = Object.keys(cssVars);

  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var value = cssVars[key];

    // Every resolvable var() was already dereferenced during extraction, so a
    // surviving one points at something this stylesheet never defines —
    // typically a next/font variable injected at runtime. Emitting it into the
    // guide's :root would declare a token that resolves to nothing. Carrying a
    // reference we cannot resolve is exactly the kind of confident-but-wrong
    // output the guide is supposed to avoid, so it is dropped and reported.
    if (/var\(\s*--/.test(String(value))) {
      if (typeof warn === 'function') {
        warn(key + ' references an undefined variable (' + value + ') — not written to the theme');
      }
      continue;
    }

    if (hasOwn(THEME_MAPPING, key) && THEME_MAPPING[key] === null) {
      if (typeof warn === 'function') {
        warn(key + ' has no brandkit equivalent (it belongs to a token that was ' +
             'remapped elsewhere) — dropped rather than guessed');
      }
      continue;
    }
    var mappedKey = THEME_MAPPING[key] || key;

    // Defensive: the table above is 1:1, but a future edit could reintroduce
    // a collision. First writer wins and the clash is reported rather than
    // silently overwriting brand data.
    if (hasOwn(claimedBy, mappedKey) && claimedBy[mappedKey] !== key) {
      if (typeof warn === 'function') {
        warn('theme token ' + mappedKey + ' already set from ' + claimedBy[mappedKey] +
             ' — ignoring ' + key);
      }
      continue;
    }

    theme[mappedKey] = value;
    claimedBy[mappedKey] = key;
  }

  return theme;
}

/* ------------------------------------------------------------------ *
 * Fonts from CSS custom properties
 * ------------------------------------------------------------------ */

var DISPLAY_FONT_VARS = ['--font-display', '--font-heading', '--font-serif'];
var BODY_FONT_VARS = ['--font-body', '--font-sans', '--font-text'];

/**
 * Reduce a font-family declaration to its first family name.
 * `var(--font-archivo), ui-sans-serif, system-ui` → `Archivo`
 *
 * Next.js `next/font` assigns a generated CSS variable, so an unresolved
 * `var(--font-archivo)` still names the family; fall back to the variable's
 * own suffix rather than discarding it.
 */
function firstFamily(value) {
  if (!value) return null;
  var v = String(value).trim();

  var head = v.split(',')[0].trim();

  var varMatch = head.match(/^var\(\s*--font-([\w-]+)/);
  if (varMatch) {
    // A next/font variable names the binding, not necessarily the typeface:
    // `--font-geist-sans` is the family "Geist", not "Geist Sans". Flag it so
    // the caller can mark the family unverified rather than publishing a
    // guess (and a Google Fonts import that 404s).
    return { family: titleCaseFamily(varMatch[1]), inferred: true, source: '--font-' + varMatch[1] };
  }

  head = head.replace(/^['"]|['"]$/g, '').trim();
  if (!head) return null;
  // A bare generic keyword tells us nothing about the brand.
  if (/^(ui-)?(sans-serif|serif|monospace|system-ui|cursive|fantasy)$/i.test(head)) return null;
  return { family: head, inferred: false, source: null };
}

function titleCaseFamily(slug) {
  return String(slug).split(/[-_]+/).filter(Boolean).map(function (w) {
    return w.charAt(0).toUpperCase() + w.slice(1);
  }).join(' ');
}

function pickFont(cssVars, names) {
  for (var i = 0; i < names.length; i++) {
    if (hasOwn(cssVars, names[i])) {
      var found = firstFamily(cssVars[names[i]]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Read display/body families from CSS custom properties.
 *
 * Tailwind v4 is CSS-first and has no tailwind.config.{js,ts}, so
 * extract-tailwind.js — which only ever reads that file — finds nothing and
 * the brandkit default ("Space Grotesk") survives as if it were the host's
 * typeface. These tokens live in the @theme block.
 */
function fontsFromVars(cssVars) {
  if (!cssVars) return null;
  var out = {};
  var display = pickFont(cssVars, DISPLAY_FONT_VARS);
  var body = pickFont(cssVars, BODY_FONT_VARS);
  if (display) out.display = { family: display.family, inferred: display.inferred, source: display.source };
  if (body) out.body = { family: body.family, inferred: body.inferred, source: body.source };
  return Object.keys(out).length ? out : null;
}

module.exports = {
  extract: extract,
  mapToTheme: mapToTheme,
  fontsFromVars: fontsFromVars,
  // exported for tests
  _internals: {
    extractFromContent: extractFromContent,
    resolveVarRefs: resolveVarRefs,
    firstFamily: firstFamily,
    matchBlocks: matchBlocks
  }
};
