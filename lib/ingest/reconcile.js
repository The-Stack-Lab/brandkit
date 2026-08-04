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

/**
 * Normalize a CSS hex color to 6 digits, or null if it isn't one.
 *
 * `#RGBA` and `#RRGGBBAA` are valid modern CSS, and a loose `{3,8}` test
 * accepts them — but hexToRgb() parses the whole string, so `#FF0000FF`
 * (opaque red) comes back as blue. Alpha is dropped here rather than allowed
 * to shift every channel by one.
 */
function normalizeHex(value) {
  var v = String(value == null ? '' : value).trim();
  var m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (!m) return null;
  var d = m[1];
  if (d.length === 4) d = d.slice(0, 3);        // #RGBA -> #RGB
  else if (d.length === 8) d = d.slice(0, 6);   // #RRGGBBAA -> #RRGGBB
  if (d.length === 3) d = d[0] + d[0] + d[1] + d[1] + d[2] + d[2];
  if (d.length !== 6) return null;              // lengths 5 and 7 are not colors
  return '#' + d.toUpperCase();
}

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

  // Rank by saturation, but verify each candidate before accepting it. Sorting
  // on saturation alone hands the brand to whatever is most vivid — a sunset in
  // a hero photo outranks the actual brand blue. An accent is a colour used
  // deliberately and repeatedly, so require it to survive a sitewide sweep.
  var candidates = pixels.list.filter(function (c) {
    return sat(c.hex) >= NEUTRAL_SAT && c.share >= ACCENT_MIN_SHARE;
  }).sort(function (a, b) { return sat(b.hex) - sat(a.hex) || b.share - a.share; }).slice(0, 6);

  if (!candidates.length) return;

  var total = imageFiles.length || pixels.pages;

  // Decode each page once and test every candidate against it. Decoding per
  // candidate instead would open the same 40 screenshots six times over — 240
  // full decodes at ~40MB each, which dominates the runtime of a whole run.
  // Per-page dominant lists are truncated, so `c.pages` undercounts an accent
  // that paints little area; this measures coverage directly.
  var stats = candidates.map(function () { return { onPages: 0, hits: 0, sampled: 0 }; });
  imageFiles.forEach(function (file) {
    var img = png.readFile(file);
    if (!img) return;
    candidates.forEach(function (c, ci) {
      var p = png.presence(img, c.hex);
      if (!p) return;
      stats[ci].hits += p.hits;
      stats[ci].sampled += p.sampled;
      if (p.share > 0.0002) stats[ci].onPages++;
    });
  });

  var best = null;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    var st = stats[i];
    var share = st.sampled ? st.hits / st.sampled : c.share;

    // Confined to a single page at trace coverage: photographic, not brand.
    if (imageFiles.length && (share < ACCENT_MIN_SHARE || st.onPages === 0)) {
      result.rejected.push({
        field: 'colors.primary', value: c.hex, source: 'pixel',
        reason: 'saturated but not used as a brand color — ' + pct(share) +
          ' of sampled pixels, on ' + st.onPages + '/' + total + ' pages'
      });
      continue;
    }
    best = { hex: c.hex, share: share, onPages: st.onPages };
    break;
  }

  if (!best) return;

  var conf = best.onPages >= 3 ? 'high' : (best.onPages >= 2 ? 'medium' : 'low');
  set(result, 'colors.primary', best.hex, 'pixel', conf,
    'most saturated non-neutral with sitewide presence: ' + pct(best.share) +
    ' of sampled pixels, on ' + best.onPages + '/' + total + ' pages');
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

/**
 * Parse a computed color, or return null.
 *
 * Only legacy `rgb()`/`rgba()` and hex are understood. Scraping the first
 * three integers out of any color string turns `oklch(0.55 0.22 264)` into
 * `#003700` and `color(display-p3 0.31 0.27 0.9)` into `#03001F` — garbage
 * that was then written at `computed`/`high`, the highest trust in the system.
 * Tailwind v4 ships an oklch palette, so this is routine, not exotic.
 * Returning null makes an unparseable color a gap instead of a wrong answer.
 */
function rgbToHex(css) {
  var s = String(css == null ? '' : css).trim();

  var hex = normalizeHex(s);
  if (hex) return hex;

  var m = /^rgba?\(\s*([\d.]+%?)[\s,]+([\d.]+%?)[\s,]+([\d.]+%?)/i.exec(s);
  if (!m) return null;

  var parts = [];
  for (var i = 1; i <= 3; i++) {
    var raw = m[i];
    var n = parseFloat(raw);
    if (isNaN(n)) return null;
    if (raw.slice(-1) === '%') n = n * 255 / 100;
    n = Math.max(0, Math.min(255, Math.round(n)));
    parts.push(('0' + n.toString(16)).slice(-2));
  }
  return '#' + parts.join('').toUpperCase();
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

      var v = normalizeHex(s.cssVars[k]);
      if (!v) return;

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

  // Evidence is computed per font. Describing the display face with the body
  // face's counts fabricates support for a font that may have none.
  function describe(f) {
    if (f.rendered > 0) {
      return { how: 'computed', conf: 'high',
        why: 'rendered on ' + f.rendered + ' measured element(s)' };
    }
    if (f.declared > 0) {
      return { how: 'declared', conf: 'medium',
        why: 'font-family declared in ' + f.declared + ' rule(s); not confirmed against a render' };
    }
    return { how: 'declared', conf: 'low',
      why: 'only seen in @font-face / webfont link — NOT confirmed as used' };
  }

  // System fallbacks render on any page that fails to load its webfont, or on
  // elements the theme never styled. They are not the brand's typeface, so
  // they must not be promoted to the display slot.
  // Roboto is deliberately absent: it is Android's system font but also a
  // common real choice, and dropping it would discard a legitimate brand face.
  var GENERIC = /^(arial|helvetica( neue)?|times( new roman)?|georgia|verdana|tahoma|courier( new)?|segoe ui|system-ui|-apple-system|blinkmacsystemfont|ui-sans-serif|sans-serif|serif|monospace)$/i;
  var branded = ranked.filter(function (f) { return !GENERIC.test(f.family); });

  var body = branded[0] || ranked[0];
  var display = branded[1] || branded[0] || ranked[1] || ranked[0];
  var b = describe(body);
  var d = describe(display);

  set(result, 'fonts.body', body.family, b.how, b.conf, b.why);
  set(result, 'fonts.display', display.family, d.how, d.conf, d.why);
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
    // Only a local path can be decoded. png.readFile() does readFileSync, so
    // on a remote URL it always returns null and the placeholder check would
    // silently never run — say so instead of implying it was verified.
    var isRemote = /^https?:/i.test(c.file);
    if (isRemote) {
      c.unverified = true;
    } else if (/\.png$/i.test(c.file)) {
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
        : '; NO brand name supplied — ranked on filename keywords only, verify before use') +
      (kept[0].unverified
        ? '; remote URL — not downloaded, so it was NOT checked for being a placeholder'
        : '')
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
      var hex = normalizeHex(c[role]);
      if (hex) claimed.push({ role: role, hex: hex, from: s.claims.file, hits: 0, sampled: 0 });
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
      var v = normalizeHex(vars[names[j]]);
      if (v) return { key: names[j], value: v, from: sources[i].source || 'stylesheet' };
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
