/**
 * Agent-native exports: project a render-shaped config.json into machine-first
 * views an AI agent or design-token tool can consume without scraping the HTML.
 *
 *   buildBrandJson(config)     → normalized, semantic brand (roles, usage, contrast, asset paths)
 *   buildTokensJson(config)    → W3C Design Tokens (DTCG) format for token tooling
 *   buildBrandMarkdown(config) → an LLM brief ("how to be on-brand") a.k.a. llms.txt
 *
 * Pure functions, Node builtins only. Contrast is computed via generate-helpers.
 */
var fs = require('fs');
var path = require('path');
var helpers = require('./generate-helpers');

var HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

// Map format aliases to the canonical set.
function normalizeFormats(formats) {
  if (!formats || formats === 'all') return ['json', 'dtcg', 'md'];
  var list = Array.isArray(formats) ? formats : [formats];
  var canon = [];
  list.forEach(function (f) {
    f = String(f).toLowerCase();
    if (f === 'all') { canon = ['json', 'dtcg', 'md']; }
    else if (f === 'json' || f === 'brand') { if (canon.indexOf('json') === -1) canon.push('json'); }
    else if (f === 'dtcg' || f === 'tokens') { if (canon.indexOf('dtcg') === -1) canon.push('dtcg'); }
    else if (f === 'md' || f === 'markdown' || f === 'llms') { if (canon.indexOf('md') === -1) canon.push('md'); }
  });
  // Return canon as-is (possibly empty) so an unknown format surfaces as
  // "nothing written" rather than silently writing every file.
  return canon;
}

/**
 * Write the requested export files into targetDir. Returns the written
 * filenames and the brand.json object (so callers can also embed it).
 */
function writeExports(config, targetDir, formats) {
  var want = normalizeFormats(formats);
  var written = [];
  var brandJson = null;
  if (want.indexOf('json') !== -1) {
    brandJson = buildBrandJson(config);
    fs.writeFileSync(path.join(targetDir, 'brand.json'), JSON.stringify(brandJson, null, 2) + '\n');
    written.push('brand.json');
  }
  if (want.indexOf('dtcg') !== -1) {
    fs.writeFileSync(path.join(targetDir, 'tokens.json'), JSON.stringify(buildTokensJson(config), null, 2) + '\n');
    written.push('tokens.json');
  }
  if (want.indexOf('md') !== -1) {
    fs.writeFileSync(path.join(targetDir, 'brand.md'), buildBrandMarkdown(config));
    written.push('brand.md');
  }
  return { written: written, brandJson: brandJson };
}

/**
 * Is this value still unfilled?
 *
 * `__TODO:` markers are written by `generate` for anything it cannot measure.
 * Nothing used to know what they meant, so they rendered verbatim, a
 * client-approval document carried maintainer instructions like "__TODO: Family
 * name inferred from the CSS variable --font-archivo … set googleImport before
 * publishing". A marker is an internal signal; it must never reach the artifact.
 */
function isUnset(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  var t = v.trim();
  return t === '' || t.indexOf('__TODO') === 0;
}

/** The value if it is filled in, else null, so prune() drops it. */
function filled(v) {
  return isUnset(v) ? null : v;
}

function isHex(v) {
  return typeof v === 'string' && HEX_RE.test(v);
}

// "#4338CA on #FFFFFF" → { ratio: "7.9:1", rating: "AAA" }
/**
 * Contrast between two CSS colours, in any colour space.
 *
 * This kept the isHex gate that 1.5.0 removed from buildTokensJson twelve lines
 * below, so on a Tailwind 4 / shadcn theme (oklch throughout) every ratio
 * came back null, prune() then dropped the whole contrast block, and brand.md's
 * Color section carried no figures at all: the one place a designer looks for
 * them. parseCssColor draws the line by parsing rather than by shape.
 */
function contrast(fg, bg) {
  var ratio = helpers.contrastRatio(fg, bg);
  if (ratio === null) return null; // genuinely unmeasurable, never invent one
  return { ratio: ratio, rating: helpers.rateContrast(ratio) };
}

// A color group is `{ label, items }` today and was a bare array before 1.1.
// Both are still in the wild (Freeway ships the bare array), so every reader
// goes through here rather than reaching for `.items`.
function colorItems(group) {
  if (!group) return [];
  var items = Array.isArray(group) ? group : group.items;
  return Array.isArray(items) ? items : [];
}

// "Logotype Dark (#100C2E)" -> "logotype-dark-100c2e"
function slugify(name) {
  return String(name == null ? '' : name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function sameHex(a, b) {
  var pa = helpers.parseCssColor(a), pb = helpers.parseCssColor(b);
  return !!(pa && pb && pa.hex === pb.hex);
}

/**
 * The measured contrast of a palette color as text on white, if the config's
 * accessibility table carries that pair. Read from the table, never computed
 * here: the table is what the guide shows a human, and the brief must not
 * disagree with it.
 */
function onWhitePair(config, hex) {
  var white = (config.theme && config.theme['--white']) || '#FFFFFF';
  var found = null;
  (config.accessibility || []).forEach(function (a) {
    if (found || !a || isUnset(a.ratio) || isUnset(a.rating)) return;
    if (!sameHex(a.fg, hex)) return;
    if (!sameHex(a.bg, white) && !sameHex(a.bg, '#FFFFFF')) return;
    found = a;
  });
  return found;
}

// "Accent" -> "Accent."  "Page background." stays as it is.
function sentence(text) {
  var t = String(text).trim();
  return /[.!?]$/.test(t) ? t : t + '.';
}

function themeVal(config, key) {
  return config.theme && config.theme[key];
}

/**
 * Normalized, agent-first brand. Encodes roles + usage + contrast, not layout.
 */
function buildBrandJson(config) {
  config = config || {};
  var brand = config.brand || {};
  var theme = config.theme || {};
  var fonts = config.fonts || {};
  var colors = config.colors || {};

  var accentFill = theme['--accent'];
  var accentOnFill = theme['--accent-foreground'];
  var accentText = theme['--accent-text'];

  var out = {
    name: brand.name || null,
    displayName: brand.displayName || brand.name || null,
    tagline: filled(brand.tagline),
    description: filled(brand.description),
    url: brand.url || null,
    version: brand.version || null,
    generatedBy: 'brandkit',
    voice: config.voice ? {
      summary: filled(config.voice.description),
      do: config.voice.do || [],
      dont: config.voice.dont || []
    } : null,
    color: {
      accent: accentFill ? {
        fill: accentFill,
        onFill: accentOnFill || null,
        asText: accentText || null,
        contrast: {
          onFill: accentOnFill ? contrast(accentOnFill, accentFill) : null,
          asTextOnWhite: accentText ? contrast(accentText, theme['--white'] || '#FFFFFF') : null
        }
      } : null,
      // Only surfaced when a brand separates its primary action from the accent.
      primary: theme['--primary'] ? {
        fill: theme['--primary'],
        onFill: theme['--primary-foreground'] || null,
        contrast: {
          onFill: theme['--primary-foreground'] ? contrast(theme['--primary-foreground'], theme['--primary']) : null
        }
      } : null,
      brand: projectColorGroup(colors.brand),
      neutral: projectColorGroup(colors.neutrals),
      semantic: projectColorGroup(colors.semantic)
    },
    gradient: (theme['--gradient-brand'] || config.gradientUsage) ? {
      brand: theme['--gradient-brand'] || null,
      subtle: theme['--gradient-brand-subtle'] || null,
      usage: config.gradientUsage ? {
        do: config.gradientUsage.do || [],
        dont: config.gradientUsage.dont || []
      } : null
    } : null,
    type: {
      display: projectFont(fonts.display),
      body: projectFont(fonts.body),
      scale: (config.typography || []).map(function (t) {
        return { name: t.name, size: t.size, weight: t.weight, tracking: t.tracking, leading: t.leading, font: t.font };
      })
    },
    spacing: (config.spacing || []).map(function (s) {
      return { token: s.token, px: s.px };
    }),
    logos: (config.logos || []).map(function (l) {
      var variants = l.variants || {};
      var formats = Object.keys(variants);
      return {
        name: l.name,
        description: filled(l.description),
        use: backgroundToUse(l.background),
        formats: formats,
        src: variants.svg || variants.png || variants.jpg || (formats.length ? variants[formats[0]] : null),
        variants: variants
      };
    }),
    accessibility: (config.accessibility || []).map(function (a) {
      return {
        pair: (a.fgName || a.fg || '') + ' on ' + (a.bgName || a.bg || ''),
        fg: a.fg, bg: a.bg, ratio: a.ratio, rating: a.rating
      };
    }),
    changelog: (config.changelog || []).map(function (e) {
      return prune({
        version: e.version || null,
        date: e.date || null,
        changes: e.changes || []
      });
    })
  };

  return prune(out);
}

function projectColorGroup(group) {
  return colorItems(group).map(function (c) {
    return prune({
      name: c.name || c.label || null,
      hex: c.hex || null,
      oklch: c.oklch || null,
      role: c.role || c.usage || null,
      token: c.cssVar || c.token || null
    });
  });
}

function projectFont(f) {
  if (!f) return null;
  return prune({ family: filled(f.family), googleImport: filled(f.googleImport), description: filled(f.description) });
}

// "Space Grotesk (Space Grotesk) a geometric sans" → "Space Grotesk, a geometric sans"
function fontLine(f) {
  // An unfilled family is a marker, not a typeface name. Guarding only the
  // description let "__TODO: Display typeface." print as the family itself.
  var family = isUnset(f.family) ? '' : f.family;
  // An unfilled description is a marker, not prose. This line is exactly where
  // "__TODO: Family name inferred from the CSS variable …" reached the client.
  var desc = isUnset(f.description) ? '' : f.description;
  if (desc) {
    var stripped = desc.replace(new RegExp('^' + family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[\\u2014\\u2013:-]\\s*'), '');
    return family + (stripped ? ': ' + stripped : '');
  }
  return family;
}

function backgroundToUse(bg) {
  if (bg === 'light') return 'light backgrounds';
  if (bg === 'dark') return 'dark backgrounds';
  if (bg === 'gradient') return 'the brand gradient';
  return null;
}

/**
 * W3C Design Tokens (DTCG): color / fontFamily / dimension groups.
 * Strict-ish so Style Dictionary, Tokens Studio, and Figma can read it.
 */
function buildTokensJson(config) {
  config = config || {};
  var theme = config.theme || {};
  var fonts = config.fonts || {};
  var brand = config.brand || {};

  // Emit every theme entry that is a single, resolvable color.
  //
  // This used to gate on isHex(), which is why a stock Tailwind 4 / shadcn
  // project (oklch() throughout) produced no `color` group at all, and the
  // block was then omitted entirely, leaving tokens.json unusable by the very
  // tools it exists to feed. The gate was still doing real work, though:
  // gradients and the "r, g, b" tint triples are not colors and must stay
  // out. parseCssColor() draws that line by parsing rather than by shape.
  //
  // $value is sRGB hex for maximum tool compatibility; when the author wrote
  // a wider-gamut space, the original is preserved in $extensions so nothing
  // is lost on the way through.
  var color = {};
  Object.keys(theme).forEach(function (key) {
    if (/-rgb$/.test(key)) return; // "79, 70, 229" is a tint triple, not a color
    var parsed = helpers.parseCssColor(theme[key]);
    if (!parsed) return;           // gradients, unresolved var(), anything unparseable

    var token = { $type: 'color', $value: parsed.hex };
    // Also true for an alpha hex (#00000080 -> #000000): the emitted value is
    // not what the author wrote, so the original has to survive somewhere.
    if (parsed.original.toUpperCase() !== parsed.hex) {
      token.$extensions = {
        'app.stacklist.brandkit': { authored: parsed.original, colorSpace: parsed.space }
      };
    }
    color[key.replace(/^--/, '')] = token;
  });

  // The theme is what the guide styles itself with, not the brand's inventory.
  // Freeway's Plum and Pink have no theme variable, so they were absent from
  // tokens.json while leftover theme variables were present. The palette is
  // nested so it can never collide with a theme key, and so a consumer can tell
  // "a color this brand owns" from "a variable the guide happens to set".
  var palette = {};
  [['brand', 'brand'], ['neutrals', 'neutral'], ['semantic', 'semantic']].forEach(function (pair) {
    colorItems((config.colors || {})[pair[0]]).forEach(function (c) {
      if (!c) return;
      var name = filled(c.name || c.label);
      var slug = slugify(name);
      if (!slug) return;
      // $value stays sRGB hex so strict DTCG readers work. oklch rides along.
      var parsed = helpers.parseCssColor(filled(c.hex)) || helpers.parseCssColor(filled(c.oklch));
      if (!parsed) return; // no measurable value: not a token
      var key = slug, n = 2;
      while (palette[key]) { key = slug + '-' + n; n++; }
      var token = { $type: 'color', $value: parsed.hex };
      var role = filled(c.role || c.usage);
      if (role) token.$description = role;
      var ext = { name: name, group: pair[1] };
      if (filled(c.oklch)) ext.oklch = c.oklch;
      if (filled(c.cssVar || c.token)) ext.cssVar = c.cssVar || c.token;
      token.$extensions = { 'app.stacklist.brandkit': ext };
      palette[key] = token;
    });
  });
  if (Object.keys(palette).length) {
    // `--palette` as a theme variable would already own color.palette.
    color[color.palette ? 'brand-palette' : 'palette'] = palette;
  }

  var fontFamily = {};
  if (fonts.display && fonts.display.family) fontFamily.display = { $type: 'fontFamily', $value: fonts.display.family };
  if (fonts.body && fonts.body.family) fontFamily.body = { $type: 'fontFamily', $value: fonts.body.family };

  var dimension = {};
  (config.spacing || []).forEach(function (s) {
    if (s.token && (s.px || s.px === 0)) dimension[s.token] = { $type: 'dimension', $value: s.px + 'px' };
  });

  var out = {
    $description: 'Design tokens for ' + (brand.displayName || brand.name || 'brand') + ' (W3C DTCG format, generated by brandkit)'
  };
  if (Object.keys(color).length) out.color = color;
  if (Object.keys(fontFamily).length) out.fontFamily = fontFamily;
  if (Object.keys(dimension).length) out.dimension = dimension;
  return out;
}

/**
 * LLM brief: drop into an agent's context to write/design on-brand.
 */
function buildBrandMarkdown(config) {
  config = config || {};
  var brand = config.brand || {};
  var theme = config.theme || {};
  var fonts = config.fonts || {};
  var name = brand.displayName || brand.name || 'Brand';
  var L = [];
  var unfilled = [];
  function need(label, value) {
    if (isUnset(value)) { unfilled.push(label); return false; }
    return true;
  }

  L.push('# ' + name + ': Brand Brief');
  L.push('');
  L.push('> Machine-readable brand guidance generated by brandkit from `config.json`.');
  L.push('> Companion files: `brand.json` (full structured brand), `tokens.json` (W3C design tokens).');
  if (need('Description', brand.description)) { L.push(''); L.push(brand.description); }

  var voice = config.voice || {};
  var voiceSummary = isUnset(voice.description) ? null : voice.description;
  var voiceDo = (voice.do || []).filter(function (d) { return !isUnset(d); });
  var voiceDont = (voice.dont || []).filter(function (d) { return !isUnset(d); });
  if (voiceSummary || voiceDo.length || voiceDont.length) {
    L.push(''); L.push('## Voice & Tone');
    if (voiceSummary) L.push(voiceSummary);
    if (voiceDo.length) {
      L.push(''); L.push('**Do:**');
      voiceDo.forEach(function (d) { L.push('- ' + d); });
    }
    if (voiceDont.length) {
      L.push(''); L.push("**Don't:**");
      voiceDont.forEach(function (d) { L.push('- ' + d); });
    }
  } else {
    // A heading with nothing under it reads as broken; say it once at the end.
    unfilled.push('Voice & tone');
  }

  L.push(''); L.push('## Color');

  // One bullet per color: name, value, role, and (where the accessibility table
  // measured it) whether it is safe as text on white.
  function colorBullet(c) {
    var cname = filled(c.name || c.label);
    var chex = filled(c.hex) || filled(c.oklch);
    if (!cname && !chex) return null;
    var line = '- ' + (cname ? '**' + cname + '**' : '') + (chex ? (cname ? ' ' : '') + '`' + chex + '`' : '');
    var role = filled(c.role || c.usage);
    if (role) line += ': ' + sentence(role);
    var pair = chex ? onWhitePair(config, chex) : null;
    if (pair) {
      var verdict = (pair.rating === 'AAA' || pair.rating === 'AA') ? 'safe for text'
        : pair.rating === 'AA Large' ? 'large text only' : 'not for text';
      line += (role ? ' ' : ': ') + 'On white: ' + pair.ratio + ' (' + pair.rating + ', ' + verdict + ').';
    }
    return line;
  }

  // The palette says what exists; the accent / primary / semantic lines below
  // say how it is used. The brief used to carry only the second half, read from
  // `theme`, so a brand's colors that no theme variable pointed at (Freeway's
  // Plum, Pink and Salmon) were never named at all.
  var paletteLines = colorItems((config.colors || {}).brand).map(colorBullet).filter(Boolean);
  if (paletteLines.length) {
    L.push('**Palette:**');
    paletteLines.forEach(function (l) { L.push(l); });
    L.push(''); L.push('**Usage:**');
  }

  var accent = theme['--accent'];
  if (accent) {
    var onFill = theme['--accent-foreground'];
    var asText = theme['--accent-text'];
    var c1 = onFill ? contrast(onFill, accent) : null;
    var c2 = asText ? contrast(asText, theme['--white'] || '#FFFFFF') : null;
    L.push('- **Accent (fill):** `' + accent + '`' + (onFill ? '. Put `' + onFill + '` text/icons on it' + (c1 ? ' (' + c1.ratio + ' ' + c1.rating + ')' : '') : '') + '.');
    if (asText) L.push('- **Accent as text/links on light:** `' + asText + '`' + (c2 ? ' (' + c2.ratio + ' ' + c2.rating + ' on white)' : '') + '.');
  }
  var primary = theme['--primary'];
  if (primary && primary !== accent) {
    var pOn = theme['--primary-foreground'];
    var pc = pOn ? contrast(pOn, primary) : null;
    L.push('- **Primary action (CTA fill):** `' + primary + '`' + (pOn ? ' with `' + pOn + '` text' + (pc ? ' (' + pc.ratio + ' ' + pc.rating + ')' : '') : '') + '.');
  }
  var sem = [];
  ['--success', '--warning', '--error'].forEach(function (k) {
    if (theme[k]) sem.push(k.replace('--', '') + ' `' + theme[k] + '`');
  });
  if (sem.length) L.push('- **Semantic:** ' + sem.join(', ') + '.');
  // Neutrals come from the config's own list. The three theme names below are
  // brandkit's starter vocabulary and only a fallback: a brand that calls its
  // text color anything but `--ink` used to get no neutrals at all.
  var neutralLines = colorItems((config.colors || {}).neutrals).map(colorBullet).filter(Boolean);
  if (neutralLines.length) {
    L.push(''); L.push('**Neutrals:**');
    neutralLines.forEach(function (l) { L.push(l); });
  } else {
    var neutralBits = [];
    if (theme['--ink']) neutralBits.push('Ink `' + theme['--ink'] + '` (primary text)');
    if (theme['--slate']) neutralBits.push('Slate `' + theme['--slate'] + '` (muted)');
    if (theme['--cloud']) neutralBits.push('Cloud `' + theme['--cloud'] + '` (page bg)');
    if (neutralBits.length) L.push('- **Neutrals:** ' + neutralBits.join(', ') + '.');
  }

  // Surface any low-contrast pairs as explicit warnings
  var warns = (config.accessibility || []).filter(function (a) {
    // A marker in ratio/rating would render as "is __TODO (__TODO), fails AA".
    if (isUnset(a.ratio) || isUnset(a.rating)) return false;
    // Caution only about pairs someone would actually set as text. Warning
    // "do not use this pair for text" about two background tones buries the
    // failures that matter.
    if (a.textPairing === false) return false;
    return a.rating && a.rating !== 'AAA' && a.rating !== 'AA';
  });
  if (warns.length) {
    L.push(''); L.push('**Contrast cautions:**');
    warns.forEach(function (a) {
      var note = a.rating === 'AA Large' ? ': large text only.' : ': fails AA, do not use this pair for text.';
      L.push('- ' + (a.fgName || a.fg) + ' on ' + (a.bgName || a.bg) + ' is ' + a.ratio + ' (' + a.rating + ')' + note);
    });
  }

  var scale = (config.typography || []).filter(function (t) { return t && !isUnset(t.name); });
  if (fonts.display || fonts.body || scale.length) {
    L.push(''); L.push('## Typography');
    [['display', 'Display'], ['body', 'Body']].forEach(function (pair) {
      var f = fonts[pair[0]];
      if (!f) return;
      // No family means there is nothing to state. Report the gap instead of
      // printing a bullet whose value is a marker.
      if (isUnset(f.family)) { unfilled.push(pair[1] + ' typeface'); return; }
      L.push('- **' + pair[1] + ':** ' + fontLine(f));
      if (isUnset(f.description)) unfilled.push(pair[1] + ' font rationale');
    });

    // The named scale. Formats refer to these styles by name, so an agent
    // needs the whole row, not just the two families.
    if (scale.length) {
      var cell = function (v) { return isUnset(v) ? '' : String(v).replace(/\|/g, '/'); };
      L.push(''); L.push('**Type scale:**'); L.push('');
      L.push('| Style | Font | Size | Weight | Tracking | Leading |');
      L.push('|---|---|---|---|---|---|');
      scale.forEach(function (t) {
        L.push('| ' + [t.name, t.font, t.size, t.weight, t.tracking, t.leading].map(cell).join(' | ') + ' |');
      });
    }
  }

  var steps = (config.spacing || []).filter(function (sp) { return sp && !isUnset(sp.token) && (sp.px || sp.px === 0); });
  if (steps.length) {
    L.push(''); L.push('## Spacing');
    L.push('- **Scale:** ' + steps.map(function (sp) { return '`' + sp.token + '` ' + sp.px + 'px'; }).join(', ') + '.');
  }

  if (config.logos && config.logos.length) {
    L.push(''); L.push('## Logos');
    config.logos.forEach(function (l) {
      var use = backgroundToUse(l.background);
      var variants = l.variants || {};
      var src = variants.svg || variants.png || variants.jpg || '';
      L.push('- **' + l.name + '**' + (use ? ': use on ' + use : '') + (src ? ' (`' + src + '`)' : ''));
    });
  }

  if (theme['--gradient-brand']) {
    L.push(''); L.push('## Gradient');
    L.push('- **Brand gradient:** `' + theme['--gradient-brand'] + '`');
    if (config.gradientUsage) {
      if (config.gradientUsage.do && config.gradientUsage.do.length) L.push('- Use for: ' + config.gradientUsage.do.join('; ') + '.');
      if (config.gradientUsage.dont && config.gradientUsage.dont.length) L.push("- Don't use for: " + config.gradientUsage.dont.join('; ') + '.');
    }
  }

  // Changelog: emitted unconditionally so an agent reading this brief always
  // learns the maintenance rule, then the history (if any). brand.md is the
  // file agents are pointed at to "stay on-brand", so the instruction lives here.
  L.push(''); L.push('## Changelog');
  L.push('When you change this brand (colors, type, logos, voice, spacing, or anything in ' +
    '`config.json`), record it so the guide keeps an accurate history. Run ' +
    '`brandkit changelog "what changed"`. It prepends an entry and bumps the version (a fresh ' +
    'guide starts at 0.1 and climbs; add `--lock` to finalize the brand at 1.0).');
  if (config.changelog && config.changelog.length) {
    L.push(''); L.push('Revision history (newest first):'); L.push('');
    config.changelog.forEach(function (e) {
      var head = '- **v' + (e.version || '?') + '**' + (e.date ? ' (' + e.date + ')' : '');
      // Boolean alone let an unfilled entry through as a history bullet.
      var changes = (e.changes || []).filter(function (c) { return !isUnset(c); });
      if (changes.length <= 1) {
        // Single change reads cleanly inline.
        L.push(head + (changes.length ? ': ' + changes[0] : ''));
      } else {
        // Multiple changes → nested bullets, so each keeps its own punctuation.
        L.push(head + ':');
        changes.forEach(function (c) { L.push('  - ' + c); });
      }
    });
  }

  // One honest statement of what is still missing, instead of marker text
  // scattered through the document. An agency can act on this; a client reading
  // it sees an acknowledged gap rather than a tooling instruction.
  if (unfilled.length) {
    L.push(''); L.push('## Not yet defined');
    L.push('These are not derivable from the codebase and still need a human or an agent:');
    L.push('');
    unfilled.forEach(function (u) { L.push('- ' + u); });
  }

  L.push('');
  return L.join('\n');
}

// Recursively drop null / empty-array / empty-object keys for a clean export.
function prune(obj) {
  // Array elements need the same gate as object values: `voice.do` is a list of
  // strings, and an unfilled entry there would survive into brand.json as
  // content even though the equivalent object value is dropped.
  if (Array.isArray(obj)) {
    return obj.map(prune).filter(function (v) {
      if (v === null || v === undefined) return false;
      if (isUnset(v)) return false;
      // An element whose every field was unfilled prunes down to {}, a hollow
      // row that reads as data. Objects and arrays are dropped when empty, the
      // same rule prune() already applies to object values.
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      return true;
    });
  }
  if (obj === null || typeof obj !== 'object') return obj;
  var out = {};
  Object.keys(obj).forEach(function (k) {
    var v = prune(obj[k]);
    if (v === null || v === undefined) return;
    // An unfilled marker is not data. Dropping it here keeps every consumer of
    // brand.json (agents included) from reading instruction text as content.
    if (isUnset(v)) return;
    if (Array.isArray(v) && v.length === 0) return;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return;
    out[k] = v;
  });
  return out;
}

module.exports = {
  isUnset: isUnset,
  buildBrandJson: buildBrandJson,
  buildTokensJson: buildTokensJson,
  buildBrandMarkdown: buildBrandMarkdown,
  writeExports: writeExports,
  normalizeFormats: normalizeFormats
};
