/**
 * Turn raw ingest results into brand tokens — with the evidence for each one.
 *
 * The governing rule: **a token with no evidence is not written.** An
 * incomplete brand board is recoverable by asking a human; a confidently wrong
 * one silently becomes the client's brand.
 *
 * Precedence, highest first:
 *   1. computed   — measured from a live rendered page (--render)
 *   2. css-var    — the site's own declared custom properties
 *   3. pixel      — painted pixels sampled from screenshots
 *   4. declared   — a font-family / stylesheet rule with no render to confirm it
 *   5. claimed    — a tokens JSON produced by some other tool. Never sufficient
 *                   on its own; must survive a presence check to be kept.
 */
var png = require('./png');
var helpers = require('../generate-helpers');

var RANK = { computed: 4, 'css-var': 3, pixel: 2, declared: 1, claimed: 0 };
var ABSENT_SHARE = 0.0001;   // 0.01% of sampled pixels — below this, a color isn't there
var ACCENT_MIN_SHARE = 0.0005;
var NEUTRAL_SAT = 28;        // max-min RGB below this reads as a neutral, not an accent

function reconcile(sources, opts) {
  opts = opts || {};
  var result = {
    tokens: { colors: {}, fonts: {}, logos: [], spacing: {} },
    evidence: {},
    conflicts: [],
    rejected: [],
    gaps: []
  };

  var pixels = aggregatePixels(sources);
  var imageFiles = allImageFiles(sources);

  resolveSurface(result, pixels, sources);
  resolveAccent(result, pixels, sources, imageFiles);
  resolveDeclaredVars(result, sources);
  resolveOnAccent(result, sources);
  resolveFonts(result, sources);
  resolveLogos(result, sources, opts.brandName);
  auditClaims(result, sources, imageFiles);

  ['colors.background', 'colors.primary', 'fonts.body'].forEach(function (f) {
    if (!result.evidence[f]) result.gaps.push(f);
  });

  return result;
}

/* ---------------------------------------------------------------- colors */

/** Sum each color's share across every screenshot, so one page can't dominate. */
function aggregatePixels(sources) {
  var totals = Object.create(null);
  var pages = 0;

  sources.forEach(function (s) {
    (s.surfaces || []).forEach(function (surface) {
      pages++;
      surface.colors.forEach(function (c) {
        if (!totals[c.hex]) totals[c.hex] = { hex: c.hex, share: 0, pages: 0 };
        totals[c.hex].share += c.share;
        totals[c.hex].pages++;
      });
    });
  });

  var list = Object.keys(totals).map(function (k) {
    return { hex: totals[k].hex, share: totals[k].share / (pages || 1), pages: totals[k].pages };
  });
  list.sort(function (a, b) { return b.share - a.share; });
  return { list: list, pages: pages };
}

function resolveSurface(result, pixels, sources) {
  var declared = pickVar(sources, ['--background', '--surface', '--bg', '--body-bg']);
  var top = pixels.list[0];

  if (declared) {
    set(result, 'colors.background', declared.value, 'css-var', 'high',
      'declared ' + declared.key + ' in ' + declared.from);
  } else if (top) {
    set(result, 'colors.background', top.hex, 'pixel', pixels.pages >= 3 ? 'high' : 'medium',
      'largest painted color on ' + top.pages + '/' + pixels.pages + ' page(s), ' +
      pct(top.share) + ' of sampled pixels');
  } else {
    return;
  }

  var bg = result.tokens.colors.background;
  var lum = helpers.relativeLuminance(bg);
  result.tokens.colorScheme = lum < 0.18 ? 'dark' : 'light';
  set(result, 'colorScheme', result.tokens.colorScheme, 'derived', 'high',
    'relative luminance of ' + bg + ' is ' + lum.toFixed(3));

  // Text color, inferred from pixels alone — deliberately conservative.
  // Glyphs are thin, so body text is a *minority* of painted pixels; a
  // high-contrast color covering a large area is another surface, not type.
  // contrastRatio() returns a display string ("13.5:1") — parse before comparing.
  var text = pixels.list.filter(function (c) {
    return sat(c.hex) < NEUTRAL_SAT &&
      c.share > 0.0005 && c.share < 0.03 &&
      c.pages >= 2 && ratio(c.hex, bg) >= 4.5;
  }).sort(function (a, b) { return ratio(b.hex, bg) - ratio(a.hex, bg); })[0];

  if (text) {
    // Never better than low without a render: this is an inference from area,
    // not a reading of a computed `color` property.
    set(result, 'colors.textPrimary', text.hex, 'pixel', 'low',
      'highest-contrast minority color against ' + bg + ' (' + pct(text.share) +
      ' of pixels on ' + text.pages + ' pages) — inferred, not read from the DOM');
  }
}

function resolveAccent(result, pixels, sources, imageFiles) {
  var declared = pickVar(sources, ['--accent', '--primary', '--brand', '--color-primary']);
  if (declared) {
    set(result, 'colors.primary', declared.value, 'css-var', 'high',
      'declared ' + declared.key + ' in ' + declared.from);
    return;
  }

  var candidate = pixels.list.filter(function (c) {
    return sat(c.hex) >= NEUTRAL_SAT && c.share >= ACCENT_MIN_SHARE;
  }).sort(function (a, b) { return sat(b.hex) - sat(a.hex) || b.share - a.share; })[0];

  if (!candidate) return;

  // Per-page dominant lists are truncated, so `candidate.pages` undercounts an
  // accent that paints little area. Re-measure it directly across every page:
  // sitewide presence is what separates a brand color from one page's photo.
  var onPages = 0, hits = 0, sampled = 0;
  imageFiles.forEach(function (file) {
    var img = png.readFile(file);
    if (!img) return;
    var p = png.presence(img, candidate.hex);
    if (!p) return;
    hits += p.hits; sampled += p.sampled;
    if (p.share > 0.0002) onPages++;
  });

  var total = imageFiles.length || pixels.pages;
  var conf = onPages >= 3 ? 'high' : (onPages >= 2 ? 'medium' : 'low');
  set(result, 'colors.primary', candidate.hex, 'pixel', conf,
    'most saturated non-neutral with sitewide presence: ' +
    pct(sampled ? hits / sampled : 0) + ' of sampled pixels, on ' + onPages + '/' + total + ' pages');
}

/**
 * What the brand actually puts on top of its accent fill.
 *
 * Worth measuring rather than computing: plenty of brands run white on a
 * mid-tone accent even where black would score higher. A guide should
 * document the real pairing and let the accessibility table flag it, not
 * quietly restyle the brand to something it never uses.
 */
function resolveOnAccent(result, sources) {
  var found = null;

  sources.forEach(function (s) {
    if (found) return;
    // From a real render: the most saturated CTA's computed text color.
    var cta = ((s.pages || []).reduce(function (acc, p) {
      return acc.concat(p.ctas || []);
    }, []))[0];
    if (cta && cta.color) {
      var hex = rgbToHex(cta.color);
      if (hex) found = { value: hex, source: 'computed', detail: 'text color of the primary CTA ("' + (cta.text || '') + '")' };
    }
  });

  sources.forEach(function (s) {
    if (found || !s.claims || !s.claims.data) return;
    var btn = (s.claims.data.components || {}).buttonPrimary;
    if (btn && /^#[0-9a-f]{6}$/i.test(String(btn.textColor))) {
      found = {
        value: btn.textColor, source: 'claimed',
        detail: 'primary button text color asserted by ' + s.claims.file
      };
    }
  });

  if (found) {
    set(result, 'colors.onPrimary', found.value, found.source,
      found.source === 'computed' ? 'high' : 'low', found.detail);
  }
}

function rgbToHex(css) {
  var m = String(css || '').match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + [0, 1, 2].map(function (i) {
    return ('0' + Number(m[i]).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

/**
 * Custom properties belonging to a CMS, UI kit, or utility framework. A
 * WordPress page declares ~80 `--wp--preset--color--*` values that are the
 * editor's stock palette, not the brand's — promoting them would bury four
 * real tokens under eighty defaults.
 */
var FRAMEWORK_VAR = /^--(wp|wp--|global--|bs-|tw-|chakra-|mui-|ion-|el-|ant-|mdc-|vs-|shiki|swiper|fa-)/i;

/** Names that plausibly describe a brand token rather than a component detail. */
var BRAND_VAR = /(accent|primary|secondary|tertiary|brand|ink|surface|background|foreground|text|link|heading|body|success|warning|error|danger|info|muted|gradient)/i;

/**
 * Component-state variants. `--danger-border` and `--success-bg` describe how
 * one widget is painted; they are downstream of a brand, not part of it.
 */
var COMPONENT_VAR = /-(bg|background|border|hover|focus|active|disabled|shadow|outline)$/i;

var MAX_DECLARED_VARS = 24;

/**
 * Promote custom properties the site declared itself — but only the ones that
 * could credibly be brand tokens. Being declared is not the same as being
 * meaningful.
 */
function resolveDeclaredVars(result, sources) {
  var taken = 0;

  sources.forEach(function (s) {
    if (!s.cssVars) return;
    Object.keys(s.cssVars).forEach(function (k) {
      if (taken >= MAX_DECLARED_VARS) return;
      if (!/^--/.test(k)) return;
      if (FRAMEWORK_VAR.test(k)) return;
      if (COMPONENT_VAR.test(k)) return;
      if (!BRAND_VAR.test(k)) return;

      var v = String(s.cssVars[k]).trim();
      if (!/^#[0-9a-f]{3,8}$/i.test(v)) return;

      var field = 'theme.' + k;
      if (result.evidence[field]) return;

      result.tokens.theme = result.tokens.theme || {};
      result.tokens.theme[k] = v;
      result.evidence[field] = {
        value: v, source: 'css-var', confidence: 'medium',
        detail: 'declared in ' + (s.source || 'stylesheet')
      };
      taken++;
    });
  });

  if (taken >= MAX_DECLARED_VARS) {
    result.notesInternal = result.notesInternal || [];
    result.notesInternal.push(
      'stopped at ' + MAX_DECLARED_VARS + ' declared custom properties — review the rest by hand');
  }
}

/* ----------------------------------------------------------------- fonts */

/**
 * A font that was downloaded is not a font that was used.
 *
 * `rendered` (from --render) is authoritative. Absent that, a family with
 * font-family rules outranks one that only appears in @font-face or a Google
 * Fonts link — the latter is a theme shipping a face it may never paint.
 */
function resolveFonts(result, sources) {
  var byFamily = Object.create(null);

  sources.forEach(function (s) {
    (s.fontsRendered || []).forEach(function (f) {
      bump(f.family, 'rendered', f.count || 1);
    });
    (s.fontsDeclared || []).forEach(function (f) {
      if (f.declared) bump(f.family, 'declared', f.declared);
      if (f.faceOnly) bump(f.family, 'faceOnly', f.faceOnly);
    });
  });

  function bump(family, how, n) {
    var key = family.toLowerCase();
    if (!byFamily[key]) byFamily[key] = { family: family, rendered: 0, declared: 0, faceOnly: 0 };
    byFamily[key][how] += n;
  }

  var all = Object.keys(byFamily).map(function (k) { return byFamily[k]; });
  var used = all.filter(function (f) { return f.rendered > 0; });
  var haveRenderData = all.some(function (f) { return f.rendered > 0; });

  // Downloaded-but-never-painted: only detectable once we know what rendered.
  if (haveRenderData) {
    all.filter(function (f) { return f.rendered === 0 && (f.faceOnly > 0 || f.declared > 0); })
      .forEach(function (f) {
        result.rejected.push({
          field: 'fonts', value: f.family, source: 'declared',
          reason: 'font loaded by the site but never rendered on any measured page'
        });
      });
  }

  var ranked = (used.length ? used : all).sort(function (a, b) {
    return (b.rendered - a.rendered) || (b.declared - a.declared) || (b.faceOnly - a.faceOnly);
  });
  if (!ranked.length) return;

  var conf = haveRenderData ? 'high' : (ranked[0].declared > 0 ? 'medium' : 'low');
  var how = haveRenderData ? 'computed' : (ranked[0].declared > 0 ? 'declared' : 'declared');
  var why = haveRenderData
    ? 'rendered on ' + ranked[0].rendered + ' measured element(s)'
    : (ranked[0].declared > 0
        ? 'font-family declared in ' + ranked[0].declared + ' rule(s); not confirmed against a render'
        : 'only seen in @font-face / webfont link — NOT confirmed as used');

  set(result, 'fonts.body', ranked[0].family, how, conf, why);
  set(result, 'fonts.display', (ranked[1] || ranked[0]).family, how, conf, why);
}

/* ----------------------------------------------------------------- logos */

/**
 * Rank image files down to the actual brand mark.
 *
 * Keyword matching is not enough — a real mark is often named for the company
 * (`graymeta-horz_color.png`) and an asset folder is usually full of *product*
 * logos, media-library duplicates, and blurred placeholders that all match
 * /logo/. Scoring by brand name first is what separates the brand's mark from
 * everything else it ships.
 */
function resolveLogos(result, sources, brandName) {
  var candidates = [];
  sources.forEach(function (s) {
    (s.imageCandidates || []).forEach(function (c) { candidates.push(c); });
  });
  if (!candidates.length) return;

  var brand = String(brandName || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  candidates.forEach(function (c) {
    var f = c.base.toLowerCase();
    var flat = f.replace(/[^a-z0-9]/g, '');
    c.score =
      (brand && flat.indexOf(brand) !== -1 ? 100 : 0) +
      (/logo|wordmark|lockup/.test(f) ? 20 : 0) +
      (/horz|horizontal/.test(f) ? 14 : 0) +
      (/vert|stacked/.test(f) ? 10 : 0) +
      (/\.svg$/.test(f) ? 12 : 0) +
      (/color|colour/.test(f) ? 6 : 0) +
      (/blur|placeholder|thumb|watermark/.test(f) ? -60 : 0) +
      (/mp4|avc|_\d{3,4}p|\.original\./.test(f) ? -80 : 0) +   // video stills
      (/favicon|picon/.test(f) ? -30 : 0) +
      (/icon/.test(f) ? -12 : 0) +
      (/^\d{3,}[-_]/.test(f) ? -25 : 0) +           // media-library ID prefixes
      (/^https?:/i.test(c.file) ? -5 : 0);          // prefer a local file to a CDN URL
  });

  // The same mark often turns up as both a local asset and a remote URL.
  var byName = Object.create(null);
  candidates = candidates.filter(function (c) {
    var key = c.base.toLowerCase().replace(/[^a-z0-9.]/g, '');
    if (byName[key]) return false;
    byName[key] = 1;
    return true;
  });

  var ranked = candidates.filter(function (c) { return c.score > 0; })
    .sort(function (a, b) { return b.score - a.score; });
  if (!ranked.length) return;

  // When the brand name matched something, keep only its peers. An asset
  // folder is full of *product* logos that also match /logo/; listing those
  // as brand variants is how a guide ends up documenting the wrong mark.
  if (ranked[0].score >= 100) {
    ranked = ranked.filter(function (c) { return c.score >= 100; });
  }

  // Decode only the finalists — enough to drop 1x1 lazy-load placeholders,
  // which is how a base64 spacer gets archived as a company's logo.
  var kept = [];
  for (var i = 0; i < ranked.length && kept.length < 4; i++) {
    var c = ranked[i];
    if (/\.png$/i.test(c.file)) {
      var img = png.readFile(c.file);
      if (img && img.width <= 4 && img.height <= 4) {
        result.rejected.push({
          field: 'logos', value: c.rel, source: 'file',
          reason: 'image is ' + img.width + 'x' + img.height + ' — a lazy-load placeholder, not a mark'
        });
        continue;
      }
    }
    kept.push(c);
  }
  if (!kept.length) return;

  result.tokens.logos = kept.map(function (c) { return { file: c.file, rel: c.rel }; });
  result.evidence['logos'] = {
    value: kept[0].rel,
    source: 'file',
    confidence: brand && kept[0].score >= 100 ? 'high' : 'low',
    detail: 'ranked ' + candidates.length + ' image file(s)' +
      (brand
        ? '; top match scored ' + kept[0].score + ' against brand name "' + brandName + '"'
        : '; NO brand name supplied — ranked on filename keywords only, verify before use')
  };
}

/* ---------------------------------------------------------------- claims */

/**
 * Test every color a third-party tool asserted against the painted pixels.
 * Anything effectively absent is dropped and recorded with its reason.
 */
function auditClaims(result, sources, imageFiles) {
  var claimed = [];
  sources.forEach(function (s) {
    if (!s.claims || !s.claims.data) return;
    var c = s.claims.data.colors || {};
    Object.keys(c).forEach(function (role) {
      if (/^#[0-9a-f]{6}$/i.test(String(c[role]))) {
        claimed.push({ role: role, hex: c[role], from: s.claims.file, hits: 0, sampled: 0 });
      }
    });
  });
  if (!claimed.length || !imageFiles.length) return;

  // Decode each screenshot once and test every claim against it, then let it go.
  // Holding all pages decoded at once would cost ~40MB each.
  imageFiles.forEach(function (file) {
    var img = png.readFile(file);
    if (!img) return;
    claimed.forEach(function (claim) {
      var p = png.presence(img, claim.hex);
      if (p) { claim.hits += p.hits; claim.sampled += p.sampled; }
    });
  });

  claimed.forEach(function (claim) {
    var share = claim.sampled ? claim.hits / claim.sampled : 0;

    if (share < ABSENT_SHARE) {
      result.rejected.push({
        field: 'colors.' + claim.role, value: claim.hex, source: 'claimed (' + claim.from + ')',
        reason: 'appears in ' + pct(share) + ' of ' + claim.sampled.toLocaleString() +
          ' sampled pixels across ' + imageFiles.length + ' page(s) — effectively absent from the site'
      });
      return;
    }

    var field = 'colors.' + claim.role;
    var existing = result.evidence[field];
    if (existing && existing.value.toUpperCase() !== claim.hex.toUpperCase()) {
      result.conflicts.push({
        field: field,
        chosen: existing.value, chosenSource: existing.source,
        rejected: claim.hex, rejectedSource: 'claimed (' + claim.from + ')',
        reason: 'measurement (' + existing.source + ') outranks an external claim; ' +
          'the claimed value covers ' + pct(share) + ' of sampled pixels'
      });
    } else if (!existing) {
      set(result, field, claim.hex, 'claimed', 'low',
        'asserted by ' + claim.from + ', confirmed present in ' + pct(share) + ' of sampled pixels');
    }
  });
}

/* ---------------------------------------------------------------- utils */

function set(result, field, value, source, confidence, detail) {
  var prev = result.evidence[field];
  if (prev && (RANK[prev.source] || 0) > (RANK[source] || 0)) return;
  result.evidence[field] = { value: value, source: source, confidence: confidence, detail: detail };
  assign(result.tokens, field, value);
}

function assign(obj, dotted, value) {
  var parts = dotted.split('.');
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function pickVar(sources, names) {
  for (var i = 0; i < sources.length; i++) {
    var vars = sources[i].cssVars;
    if (!vars) continue;
    for (var j = 0; j < names.length; j++) {
      var v = vars[names[j]];
      if (v && /^#[0-9a-f]{3,8}$/i.test(String(v).trim())) {
        return { key: names[j], value: String(v).trim(), from: sources[i].source || 'stylesheet' };
      }
    }
  }
  return null;
}

function allImageFiles(sources) {
  var out = [];
  sources.forEach(function (s) { (s._imageFiles || []).forEach(function (f) { out.push(f); }); });
  return out;
}

/** contrastRatio() returns "7.2:1"; callers here need the number. */
function ratio(a, b) {
  return parseFloat(helpers.contrastRatio(a, b)) || 0;
}

function sat(hex) {
  var c = helpers.hexToRgb(hex);
  if (!c) return 0;
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
}

function pct(x) { return (x * 100).toFixed(4) + '%'; }

module.exports = { reconcile: reconcile };
