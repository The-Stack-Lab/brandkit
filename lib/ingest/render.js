/**
 * Optional escalation: measure a live page in a real browser.
 *
 * brandkit ships zero dependencies, so Playwright is **detected, never
 * required**. If it resolves in the host project, `--render` reads computed
 * styles: the only way to know what a page actually paints. If it doesn't,
 * this returns null with a reason and the caller falls back to static fetching.
 *
 * Why it matters: a stylesheet says what was requested; computed style says
 * what won. A site can self-host a webfont it never applies, and a static read
 * cannot tell the difference: that is exactly how a brand ends up documenting
 * a typeface nobody sees.
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var png = require('./png');

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

/** Runs in the page. Returns plain data only, no nodes, no functions. */
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

  // Only legacy rgb()/rgba() is scored. Reading three arbitrary numbers out of
  // oklch()/lab()/color() yields a meaningless saturation and would rank the
  // wrong element as the primary CTA.
  var sat = function (c) {
    var m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(String(c || ''));
    if (!m) return -1;
    var r = +m[1], g = +m[2], b = +m[3];
    return Math.max(r, g, b) - Math.min(r, g, b);
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

  var log = opts.log || function () {};
  var browser, context;
  return pw.chromium.launch({ headless: true }).then(function (b) {
    browser = b;
    return b.newContext({ viewport: { width: 1440, height: 900 } });
  }).then(function (ctx) {
    context = ctx;
    return urls.reduce(function (chain, url) {
      return chain.then(function () {
        log('      loading ' + url);
        return ctx.newPage().then(function (page) {
          // 'load', not 'networkidle': Playwright's own docs discourage
          // networkidle, and any analytics beacon, chat widget, or poll keeps
          // the network busy forever: the page renders fine but the wait
          // times out and the whole measurement is discarded.
          return page.goto(url, { waitUntil: 'load', timeout: 30000 })
            .then(function () { return page.evaluate('document.fonts.ready').catch(function () {}); })
            .then(function () { return page.evaluate(MEASURE); })
            .then(function (data) {
              out.pages.push(data);
              // Also capture pixels. The DOM knows what each element declared,
              // but not what dominates the page: on a site whose <body> computes
              // white while inner sections paint near-black, the largest
              // element's background-color is the opposite of what a reader
              // sees. Surfaces are decided from pixels in every mode.
              // mkdtemp gives a unique, 0700 directory. A predictable path in
              // a shared /tmp lets a pre-planted symlink redirect the write.
              if (!out._tmpDir) out._tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandkit-'));
              var shot = path.join(out._tmpDir, 'page-' + out.pages.length + '.png');
              return page.screenshot({ fullPage: true, path: shot })
                .then(function () { out._imageFiles.push(shot); })
                .catch(function (e) { out.notes.push('screenshot failed for ' + url + ': ' + e.message); });
            })
            .catch(function (e) { out.notes.push('measure failed for ' + url + ': ' + e.message); })
            .then(function () { return page.close(); });
        });
      });
    }, Promise.resolve());
  }).then(function () {
    return closeAll();
  }).then(function () {
    return fold(out);
  }).catch(function (e) {
    // browser.close() returns a promise; a synchronous try/catch cannot catch
    // its rejection, and an unhandled rejection terminates Node. Since the
    // usual reason for being here is a crashed browser, that path matters.
    return closeAll().then(function () {
      return { ok: false, reason: 'render failed: ' + (e && e.message ? e.message : String(e)) };
    });
  });

  function closeAll() {
    return Promise.resolve()
      .then(function () { return context && context.close(); })
      .catch(function () { /* already gone */ })
      .then(function () { return browser && browser.close(); })
      .catch(function () { /* already gone */ });
  }
}

/** Collapse per-page measurements into the shared ingest shape. */
function fold(out) {
  // Measuring nothing is a failure, not an empty success. Reporting ok here
  // made the caller skip its static-fetch fallback, so asking for higher
  // fidelity produced a worse result than not asking, and with the
  // no-usable-source gate, a hard failure on a site plain --from handles.
  if (!out.pages.length) {
    cleanup(out);
    return {
      ok: false,
      reason: 'the page(s) could not be measured' +
        (out.notes.length ? ': ' + out.notes.join('; ') : '')
    };
  }
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

    if (p.logo && !p.logo.isPlaceholder && p.logo.src && !/^data:/i.test(p.logo.src)) {
      // Derive the basename from the pathname, not the raw string: a query
      // string otherwise rides along and `logo.png?v=2` becomes a config
      // variant key of "png?v=2".
      var base;
      try { base = new URL(p.logo.src).pathname.split('/').pop(); }
      catch (_) { base = String(p.logo.src).split('/').pop().split('?')[0]; }
      out.imageCandidates.push({ file: p.logo.src, rel: p.logo.src, base: base || 'logo' });
    }
  });

  out.fontsRendered = Object.keys(fonts).map(function (f) {
    return { family: f, count: fonts[f] };
  }).sort(function (a, b) { return b.count - a.count; });

  // Loaded-but-never-rendered: recorded so reconcile can reject them by name.
  out.fontsDeclared = Object.keys(loadedAll).map(function (f) {
    return { family: f, declared: 0, faceOnly: 1 };
  });

  // Surfaces come from the captured pixels, never from computed
  // background-color: see the screenshot note in measure().
  out._imageFiles.forEach(function (file) {
    var img = png.readFile(file);
    if (!img) {
      // Say so. Since surfaces come only from pixels in render mode, a capture
      // that fails to decode turns colors.background into a silent gap.
      out.notes.push('could not decode the capture of ' + path.basename(file) +
        ', no surface evidence from that page');
      return;
    }
    out.surfaces.push({
      file: file, width: img.width, height: img.height,
      colors: png.dominantColors(img, { top: 14 })
    });
  });

  if (!Object.keys(out.cssVars).length) out.cssVars = null;
  out.ok = true;
  out.notes.push('measured ' + out.pages.length + ' page(s) with a real browser' +
    (out.surfaces.length ? ', including ' + out.surfaces.length + ' full-page capture(s)' : ''));

  // Captures are NOT deleted here: reconcile still re-reads them for the
  // accent sweep and the claim audit. The orchestrator calls cleanup() once
  // reconciliation is done.
  return out;
}

/**
 * Remove captures and their temp directory. Full-page screenshots run 5-30MB
 * each and would otherwise accumulate for the life of the machine.
 */
function cleanup(out) {
  if (!out) return;
  (out._imageFiles || []).forEach(function (file) {
    try { fs.unlinkSync(file); } catch (_) { /* already gone */ }
  });
  out._imageFiles = [];
  if (out._tmpDir) {
    try { fs.rmdirSync(out._tmpDir); } catch (_) { /* not empty or already gone */ }
    out._tmpDir = null;
  }
}


module.exports = { available: available, measure: measure, cleanup: cleanup };
