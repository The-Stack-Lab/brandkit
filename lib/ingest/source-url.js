/**
 * Ingest a live URL using only Node builtins (fetch, since Node 18).
 *
 * This reads what the page *declares*: linked and inline stylesheets, custom
 * properties, font-family rules, the header logo, theme-color. It cannot read
 * what the page *computes* — anything applied by JavaScript at runtime is
 * invisible here. That ceiling is reported honestly in `notes` so `reconcile`
 * can rank these findings below a real render (see ./render.js).
 *
 * All fetched content is untrusted input: nothing here executes it, and only
 * pattern-matched values ever reach the caller.
 */
var sourceDir = require('./source-dir');

var UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
         '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
var MAX_BYTES = 4e6;
var MAX_SHEETS = 12;

function ingest(url, opts) {
  opts = opts || {};
  var out = {
    kind: 'url',
    source: url,
    surfaces: [],
    cssVars: null,
    fontsDeclared: [],
    logos: [],
    imageCandidates: [],
    claims: null,
    notes: [],
    _imageFiles: []
  };

  var safe = safeUrl(url);
  if (!safe) {
    out.notes.push('refusing unsafe or non-http(s) URL: ' + url);
    return Promise.resolve(out);
  }

  return get(safe).then(function (html) {
    if (html == null) {
      out.notes.push('could not fetch ' + safe);
      return out;
    }

    sourceDir.collectFonts(html, out.fontsDeclared);

    var vars = {};
    mergeVars(vars, html);

    var sheets = stylesheetUrls(html, safe).slice(0, MAX_SHEETS);
    return sequential(sheets, function (href) {
      return get(href).then(function (css) {
        if (css == null) { out.notes.push('could not fetch stylesheet ' + href); return; }
        mergeVars(vars, css);
        sourceDir.collectFonts(css, out.fontsDeclared);
      });
    }).then(function () {
      if (Object.keys(vars).length) out.cssVars = vars;

      var logo = headerLogo(html, safe);
      if (logo) out.imageCandidates.push({ file: logo, rel: logo, base: basename(logo) });

      var theme = /<meta[^>]+name=["']theme-color["'][^>]+content=["']([^"']+)/i.exec(html);
      if (theme && /^#[0-9a-f]{3,8}$/i.test(theme[1].trim())) {
        out.cssVars = out.cssVars || {};
        if (!out.cssVars['--background']) out.cssVars['--theme-color'] = theme[1].trim();
      }

      out.notes.push(
        'static fetch only — declared values, not computed. Colors and fonts applied ' +
        'by JavaScript at runtime are not visible; use --render for measured values.');
      out.notes.push('read ' + sheets.length + ' stylesheet(s), ' +
        Object.keys(vars).length + ' custom propert(ies)');
      return out;
    });
  }).catch(function (e) {
    out.notes.push('fetch failed: ' + (e && e.message ? e.message : String(e)));
    return out;
  });
}

/* ---------------------------------------------------------------- helpers */

/** Only http(s), and nothing that would be unsafe to hand onward. */
function safeUrl(raw) {
  var u;
  try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (/[`$\\"\s]/.test(u.href)) return null;
  return u.href;
}

function get(url) {
  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 20000);
  return fetch(url, {
    redirect: 'follow',
    signal: ctrl.signal,
    headers: { 'user-agent': UA, accept: '*/*' }
  }).then(function (res) {
    clearTimeout(timer);
    if (!res.ok) return null;
    var len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) return null;
    return res.text().then(function (t) { return t.length > MAX_BYTES ? t.slice(0, MAX_BYTES) : t; });
  }).catch(function () { clearTimeout(timer); return null; });
}

/** Run promise-returning work one at a time — polite to the origin. */
function sequential(items, fn) {
  return items.reduce(function (chain, item) {
    return chain.then(function () { return fn(item); });
  }, Promise.resolve());
}

function stylesheetUrls(html, base) {
  var out = [];
  var re = /<link\b[^>]*>/gi;
  var tag;
  while ((tag = re.exec(html)) !== null) {
    var t = tag[0];
    if (!/rel=["']?stylesheet/i.test(t)) continue;
    var href = /href=["']([^"']+)["']/i.exec(t);
    if (!href) continue;
    try { out.push(new URL(href[1], base).href); } catch (_) { /* skip */ }
  }
  return out;
}

function mergeVars(target, text) {
  // Inline <style> blocks count as declarations too.
  var blocks = [];
  var re = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  var m;
  while ((m = re.exec(text)) !== null) blocks.push(m[1]);
  var body = blocks.length ? blocks.join('\n') : text;

  var rootRe = /(?::root|html)\s*\{([^}]+)\}/g;
  while ((m = rootRe.exec(body)) !== null) {
    var lineRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    var line;
    while ((line = lineRe.exec(m[1])) !== null) {
      var k = line[1].trim();
      if (!(k in target)) target[k] = line[2].trim();
    }
  }
}

function headerLogo(html, base) {
  var head = html.slice(0, 200000);
  var re = /<img\b[^>]*>/gi;
  var tag;
  while ((tag = re.exec(head)) !== null) {
    var t = tag[0];
    if (!/logo|brand|wordmark/i.test(t)) continue;
    // Prefer a real source over a lazy-load placeholder.
    var src = /(?:data-src|data-lazy-src)=["']([^"']+)["']/i.exec(t) ||
              /\bsrc=["']([^"']+)["']/i.exec(t);
    if (!src || /^data:/i.test(src[1])) continue;
    try { return new URL(src[1], base).href; } catch (_) { /* skip */ }
  }
  return null;
}

function basename(u) {
  try { return new URL(u).pathname.split('/').pop() || u; } catch (_) { return u; }
}

module.exports = { ingest: ingest, safeUrl: safeUrl };
