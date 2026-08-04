/**
 * Optional escalation: measure a live page in a real browser.
 *
 * brandkit ships zero dependencies, so Playwright is **detected, never
 * required**. If it resolves in the host project, `--render` reads computed
 * styles — the only way to know what a page actually paints. If it doesn't,
 * this returns null with a reason and the caller falls back to static fetching.
 *
 * Why it matters: a stylesheet says what was requested; computed style says
 * what won. A site can self-host a webfont it never applies, and a static read
 * cannot tell the difference — that is exactly how a brand ends up documenting
 * a typeface nobody sees.
 */

function available() {
  try {
    require.resolve('playwright');
    return { ok: true, module: 'playwright' };
  } catch (_) { /* try the lighter package */ }
  try {
    require.resolve('playwright-core');
    return { ok: true, module: 'playwright-core' };
  } catch (_) {
    return {
      ok: false,
      reason: 'Playwright is not installed in this project. ' +
        'Install it (`npm i -D playwright && npx playwright install chromium`) for measured ' +
        'computed styles, or omit --render to use static fetching.'
    };
  }
}

/** Runs in the page. Returns plain data only — no nodes, no functions. */
var MEASURE = function () {
  var val = function (el, p) { return el ? getComputedStyle(el).getPropertyValue(p).trim() : null; };
  var box = function (el) { var r = el.getBoundingClientRect(); return r.width * r.height; };
  var opaque = function (c) { return c && !/transparent|rgba\([^)]*,\s*0\s*\)/.test(c); };

  var surfaces = [].slice.call(document.querySelectorAll('body,main,header,footer,section,div'))
    .filter(function (el) { return box(el) > 40000; })
    .map(function (el) { return { bg: val(el, 'background-color'), area: Math.round(box(el)) }; })
    .filter(function (s) { return opaque(s.bg); })
    .sort(function (a, b) { return b.area - a.area; })
    .slice(0, 8);

  // What actually rendered, weighted by element count.
  var rendered = {};
  [].slice.call(document.querySelectorAll('h1,h2,h3,p,a,button,li')).forEach(function (el) {
    var f = val(el, 'font-family');
    if (!f) return;
    var first = f.split(',')[0].replace(/["']/g, '').trim();
    if (first) rendered[first] = (rendered[first] || 0) + 1;
  });

  var loaded = [];
  try {
    document.fonts.forEach(function (f) {
      if (f.status === 'loaded') loaded.push(f.family.replace(/["']/g, ''));
    });
  } catch (e) { /* Font Loading API unavailable */ }

  var cssVars = {};
  var sheets = [].slice.call(document.styleSheets);
  for (var i = 0; i < sheets.length; i++) {
    var rules;
    try { rules = sheets[i].cssRules; } catch (e) { continue; } // cross-origin
    for (var j = 0; rules && j < rules.length; j++) {
      var r = rules[j];
      if (!r.selectorText || (r.selectorText !== ':root' && r.selectorText !== 'html')) continue;
      for (var k = 0; k < r.style.length; k++) {
        var prop = r.style[k];
        if (prop.indexOf('--') === 0) cssVars[prop] = r.style.getPropertyValue(prop).trim();
      }
    }
  }

  var sat = function (c) {
    var m = c && c.match(/\d+/g);
    if (!m) return -1;
    var n = m.map(Number);
    return Math.max(n[0], n[1], n[2]) - Math.min(n[0], n[1], n[2]);
  };
  var ctas = [].slice.call(document.querySelectorAll('a,button'))
    .map(function (el) {
      return {
        text: (el.innerText || '').trim().slice(0, 40),
        bg: val(el, 'background-color'), color: val(el, 'color'),
        radius: val(el, 'border-radius'), area: Math.round(box(el))
      };
    })
    .filter(function (c) { return opaque(c.bg) && c.area > 800; })
    .sort(function (a, b) { return sat(b.bg) - sat(a.bg) || b.area - a.area; })
    .slice(0, 5);

  var img = document.querySelector(
    'header a[href="/"] img, header img, [class*="logo" i] img, a[class*="logo" i] img');

  var role = function (sel) {
    var el = document.querySelector(sel);
    return el ? { sel: sel, color: val(el, 'color'), bg: val(el, 'background-color'),
                  font: val(el, 'font-family'), size: val(el, 'font-size'),
                  weight: val(el, 'font-weight') } : null;
  };

  return {
    url: location.href,
    surfaces: surfaces, rendered: rendered, loaded: loaded, cssVars: cssVars, ctas: ctas,
    roles: ['h1', 'h2', 'p', 'nav a', 'main a'].map(role).filter(Boolean),
    logo: img ? {
      src: img.currentSrc || img.src, alt: img.alt,
      natural: [img.naturalWidth, img.naturalHeight],
      isPlaceholder: img.naturalWidth <= 4 && img.naturalHeight <= 4
    } : null
  };
};

/**
 * Measure one or more URLs. Resolves to an ingest-shaped result, or null if
 * Playwright isn't available (the caller then falls back to static fetch).
 */
function measure(urls, opts) {
  opts = opts || {};
  var probe = available();
  if (!probe.ok) return Promise.resolve({ ok: false, reason: probe.reason });

  var pw = require(probe.module);
  var out = {
    kind: 'render', source: urls[0], surfaces: [], cssVars: {},
    fontsRendered: [], fontsDeclared: [], logos: [], imageCandidates: [],
    claims: null, notes: [], _imageFiles: [], pages: []
  };

  var browser;
  return pw.chromium.launch({ headless: true }).then(function (b) {
    browser = b;
    return b.newContext({ viewport: { width: 1440, height: 900 } });
  }).then(function (ctx) {
    return urls.reduce(function (chain, url) {
      return chain.then(function () {
        return ctx.newPage().then(function (page) {
          return page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
            .then(function () { return page.evaluate('document.fonts.ready').catch(function () {}); })
            .then(function () { return page.evaluate(MEASURE); })
            .then(function (data) { out.pages.push(data); })
            .catch(function (e) { out.notes.push('measure failed for ' + url + ': ' + e.message); })
            .then(function () { return page.close(); });
        });
      });
    }, Promise.resolve());
  }).then(function () {
    return browser.close();
  }).then(function () {
    return fold(out);
  }).catch(function (e) {
    if (browser) { try { browser.close(); } catch (_) { /* already gone */ } }
    return { ok: false, reason: 'render failed: ' + (e && e.message ? e.message : String(e)) };
  });
}

/** Collapse per-page measurements into the shared ingest shape. */
function fold(out) {
  var fonts = Object.create(null);
  var loadedAll = Object.create(null);

  out.pages.forEach(function (p) {
    Object.keys(p.cssVars || {}).forEach(function (k) {
      if (!(k in out.cssVars)) out.cssVars[k] = p.cssVars[k];
    });
    Object.keys(p.rendered || {}).forEach(function (f) {
      fonts[f] = (fonts[f] || 0) + p.rendered[f];
    });
    (p.loaded || []).forEach(function (f) { loadedAll[f] = 1; });

    // Surfaces become pseudo "dominant colors" weighted by painted area, so
    // reconcile can treat rendered and pixel evidence uniformly.
    var total = (p.surfaces || []).reduce(function (n, s) { return n + s.area; }, 0) || 1;
    out.surfaces.push({
      file: p.url,
      colors: (p.surfaces || []).map(function (s) {
        return { hex: toHex(s.bg), share: s.area / total, count: s.area };
      }).filter(function (c) { return c.hex; })
    });

    if (p.logo && !p.logo.isPlaceholder && p.logo.src && !/^data:/i.test(p.logo.src)) {
      out.imageCandidates.push({
        file: p.logo.src, rel: p.logo.src,
        base: String(p.logo.src).split('/').pop()
      });
    }
  });

  out.fontsRendered = Object.keys(fonts).map(function (f) {
    return { family: f, count: fonts[f] };
  }).sort(function (a, b) { return b.count - a.count; });

  // Loaded-but-never-rendered — recorded so reconcile can reject them by name.
  out.fontsDeclared = Object.keys(loadedAll).map(function (f) {
    return { family: f, declared: 0, faceOnly: 1 };
  });

  if (!Object.keys(out.cssVars).length) out.cssVars = null;
  out.ok = true;
  out.notes.push('measured ' + out.pages.length + ' page(s) with a real browser');
  return out;
}

function toHex(css) {
  var m = String(css || '').match(/\d+/g);
  if (!m || m.length < 3) return null;
  return '#' + [0, 1, 2].map(function (i) {
    return ('0' + Number(m[i]).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

module.exports = { available: available, measure: measure };
