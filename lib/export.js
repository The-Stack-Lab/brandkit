/**
 * Agent-native exports — project a render-shaped config.json into machine-first
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

function isHex(v) {
  return typeof v === 'string' && HEX_RE.test(v);
}

// "#4338CA on #FFFFFF" → { ratio: "7.9:1", rating: "AAA" }
function contrast(fg, bg) {
  if (!isHex(fg) || !isHex(bg)) return null;
  var ratio = helpers.contrastRatio(fg, bg);
  return { ratio: ratio, rating: helpers.rateContrast(ratio) };
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
    tagline: brand.tagline || null,
    description: brand.description || null,
    url: brand.url || null,
    version: brand.version || null,
    generatedBy: 'brandkit',
    voice: config.voice ? {
      summary: config.voice.description || null,
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
        return { name: t.name, size: t.size, weight: t.weight, font: t.font };
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
        description: l.description || null,
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
  if (!group) return [];
  var items = group.items || group;
  if (!Array.isArray(items)) return [];
  return items.map(function (c) {
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
  return prune({ family: f.family || null, googleImport: f.googleImport || null, description: f.description || null });
}

// "Space Grotesk — Space Grotesk — a geometric sans" → "Space Grotesk — a geometric sans"
function fontLine(f) {
  var family = f.family || '';
  var desc = f.description || '';
  if (desc) {
    var stripped = desc.replace(new RegExp('^' + family.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[—:-]\\s*'), '');
    return family + (stripped ? ' — ' + stripped : '');
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
 * W3C Design Tokens (DTCG) — color / fontFamily / dimension groups.
 * Strict-ish so Style Dictionary, Tokens Studio, and Figma can read it.
 */
function buildTokensJson(config) {
  config = config || {};
  var theme = config.theme || {};
  var fonts = config.fonts || {};
  var brand = config.brand || {};

  var color = {};
  Object.keys(theme).forEach(function (key) {
    var val = theme[key];
    if (isHex(val)) {
      color[key.replace(/^--/, '')] = { $type: 'color', $value: val };
    }
  });

  var fontFamily = {};
  if (fonts.display && fonts.display.family) fontFamily.display = { $type: 'fontFamily', $value: fonts.display.family };
  if (fonts.body && fonts.body.family) fontFamily.body = { $type: 'fontFamily', $value: fonts.body.family };

  var dimension = {};
  (config.spacing || []).forEach(function (s) {
    if (s.token && (s.px || s.px === 0)) dimension[s.token] = { $type: 'dimension', $value: s.px + 'px' };
  });

  var out = {
    $description: 'Design tokens for ' + (brand.displayName || brand.name || 'brand') + ' — W3C DTCG format, generated by brandkit'
  };
  if (Object.keys(color).length) out.color = color;
  if (Object.keys(fontFamily).length) out.fontFamily = fontFamily;
  if (Object.keys(dimension).length) out.dimension = dimension;
  return out;
}

/**
 * LLM brief — drop into an agent's context to write/design on-brand.
 */
function buildBrandMarkdown(config) {
  config = config || {};
  var brand = config.brand || {};
  var theme = config.theme || {};
  var fonts = config.fonts || {};
  var name = brand.displayName || brand.name || 'Brand';
  var L = [];

  L.push('# ' + name + ' — Brand Brief');
  L.push('');
  L.push('> Machine-readable brand guidance generated by brandkit from `config.json`.');
  L.push('> Companion files: `brand.json` (full structured brand), `tokens.json` (W3C design tokens).');
  if (brand.description) { L.push(''); L.push(brand.description); }

  if (config.voice) {
    L.push(''); L.push('## Voice & Tone');
    if (config.voice.description) L.push(config.voice.description);
    if (config.voice.do && config.voice.do.length) {
      L.push(''); L.push('**Do:**');
      config.voice.do.forEach(function (d) { L.push('- ' + d); });
    }
    if (config.voice.dont && config.voice.dont.length) {
      L.push(''); L.push("**Don't:**");
      config.voice.dont.forEach(function (d) { L.push('- ' + d); });
    }
  }

  L.push(''); L.push('## Color');
  var accent = theme['--accent'];
  if (accent) {
    var onFill = theme['--accent-foreground'];
    var asText = theme['--accent-text'];
    var c1 = onFill ? contrast(onFill, accent) : null;
    var c2 = asText ? contrast(asText, theme['--white'] || '#FFFFFF') : null;
    L.push('- **Accent (fill):** `' + accent + '`' + (onFill ? ' — put `' + onFill + '` text/icons on it' + (c1 ? ' (' + c1.ratio + ' ' + c1.rating + ')' : '') : '') + '.');
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
  var neutralBits = [];
  if (theme['--ink']) neutralBits.push('Ink `' + theme['--ink'] + '` (primary text)');
  if (theme['--slate']) neutralBits.push('Slate `' + theme['--slate'] + '` (muted)');
  if (theme['--cloud']) neutralBits.push('Cloud `' + theme['--cloud'] + '` (page bg)');
  if (neutralBits.length) L.push('- **Neutrals:** ' + neutralBits.join(', ') + '.');

  // Surface any low-contrast pairs as explicit warnings
  var warns = (config.accessibility || []).filter(function (a) {
    return a.rating && a.rating !== 'AAA' && a.rating !== 'AA';
  });
  if (warns.length) {
    L.push(''); L.push('**Contrast cautions:**');
    warns.forEach(function (a) {
      var note = a.rating === 'AA Large' ? ' — large text only.' : ' — fails AA; do not use this pair for text.';
      L.push('- ' + (a.fgName || a.fg) + ' on ' + (a.bgName || a.bg) + ' is ' + a.ratio + ' (' + a.rating + ')' + note);
    });
  }

  if (fonts.display || fonts.body) {
    L.push(''); L.push('## Typography');
    if (fonts.display) L.push('- **Display:** ' + fontLine(fonts.display));
    if (fonts.body) L.push('- **Body:** ' + fontLine(fonts.body));
  }

  if (config.logos && config.logos.length) {
    L.push(''); L.push('## Logos');
    config.logos.forEach(function (l) {
      var use = backgroundToUse(l.background);
      var variants = l.variants || {};
      var src = variants.svg || variants.png || variants.jpg || '';
      L.push('- **' + l.name + '**' + (use ? ' — use on ' + use : '') + (src ? ' — `' + src + '`' : ''));
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

  // Changelog — emitted unconditionally so an agent reading this brief always
  // learns the maintenance rule, then the history (if any). brand.md is the
  // file agents are pointed at to "stay on-brand", so the instruction lives here.
  L.push(''); L.push('## Changelog');
  L.push('When you change this brand — colors, type, logos, voice, spacing, or anything in ' +
    '`config.json` — record it so the guide keeps an accurate history: run ' +
    '`brandkit changelog "what changed"`. It prepends an entry and bumps the version (a fresh ' +
    'guide starts at 0.1 and climbs; add `--lock` to finalize the brand at 1.0).');
  if (config.changelog && config.changelog.length) {
    L.push(''); L.push('Revision history (newest first):'); L.push('');
    config.changelog.forEach(function (e) {
      var head = '- **v' + (e.version || '?') + '**' + (e.date ? ' (' + e.date + ')' : '');
      var changes = (e.changes || []).filter(Boolean);
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

  L.push('');
  return L.join('\n');
}

// Recursively drop null / empty-array / empty-object keys for a clean export.
function prune(obj) {
  if (Array.isArray(obj)) return obj.map(prune);
  if (obj === null || typeof obj !== 'object') return obj;
  var out = {};
  Object.keys(obj).forEach(function (k) {
    var v = prune(obj[k]);
    if (v === null || v === undefined) return;
    if (Array.isArray(v) && v.length === 0) return;
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0) return;
    out[k] = v;
  });
  return out;
}

module.exports = {
  buildBrandJson: buildBrandJson,
  buildTokensJson: buildTokensJson,
  buildBrandMarkdown: buildBrandMarkdown,
  writeExports: writeExports,
  normalizeFormats: normalizeFormats
};
