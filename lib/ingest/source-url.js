/**
 * Ingest a live URL using only Node builtins (fetch, since Node 18).
 *
 * This reads what the page *declares*: linked and inline stylesheets, custom
 * properties, font-family rules, the header logo, theme-color. It cannot read
 * what the page *computes*: anything applied by JavaScript at runtime is
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

      // Scan meta tags one at a time. A single pattern with two `[^>]+` runs
      // separated by literals is quadratic on pages with many <meta> tags.
      var metaRe = /<meta\b[^>]*>/gi;
      var tag;
      while ((tag = metaRe.exec(html)) !== null) {
        if (!/name=["']?theme-color/i.test(tag[0])) continue;
        var content = /content=["']([^"']+)["']/i.exec(tag[0]);
        if (content && /^#[0-9a-f]{3,8}$/i.test(content[1].trim())) {
          out.cssVars = out.cssVars || {};
          if (!out.cssVars['--background']) out.cssVars['--theme-color'] = content[1].trim();
        }
        break;
      }

      out.notes.push(
        'static fetch only: declared values, not computed. Colors and fonts applied ' +
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

/**
 * Hosts that must never be fetched.
 *
 * `--from <url>` makes brandkit fetch on the operator's behalf, and a crawled
 * page controls the stylesheet URLs that follow. Without this, a page could
 * point at a cloud metadata endpoint or an internal service and have the
 * response merged into config.json and ingest-evidence.json.
 */
function isBlockedHost(hostname) {
  var h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || /(^|\.)localhost$/.test(h)) return true;
  if (/\.(local|internal|intranet|home\.arpa)$/.test(h)) return true;

  // Everything in ::/96: ::1, ::, and short forms like ::a that resolve into
  // the reserved IPv4-compatible range. Cheaper to refuse the whole block than
  // to enumerate the spellings Node's URL normalizer can produce.
  if (/^::([0-9a-f]{1,4})?$/i.test(h)) return true;
  if (/^fe80:/i.test(h) || /^f[cd][0-9a-f]{2}:/i.test(h)) return true;   // link-local, ULA
  // IPv4-mapped IPv6. `new URL` normalizes ::ffff:127.0.0.1 to the hex form
  // ::ffff:7f00:1, so both spellings have to be decoded and re-checked.
  var mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(h);
  if (mappedDotted) return isBlockedHost(mappedDotted[1]);
  var mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(h);
  if (mappedHex) {
    var hi = parseInt(mappedHex[1], 16), lo = parseInt(mappedHex[2], 16);
    return isBlockedHost([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.'));
  }

  var v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    var a = +v4[1], b = +v4[2];
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 169 && b === 254) return true;          // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true;                         // multicast / reserved
  }
  return false;
}

/** Only http(s), and never a host that points back inside the network. */
function safeUrl(raw) {
  var u;
  try { u = new URL(String(raw).trim()); } catch (_) { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (isBlockedHost(u.hostname)) return null;
  return u.href;
}

/**
 * Fetch with the size and time limits actually enforced.
 *
 * Redirects are followed by hand so every hop is re-checked, `redirect:
 * 'follow'` would let a public URL bounce to an internal one. The body is read
 * incrementally so a chunked or gzipped response cannot buffer past the cap
 * before anyone looks at its length, and the deadline covers the body rather
 * than stopping once headers arrive.
 */
function get(url, hops) {
  var remaining = hops == null ? 3 : hops;
  var safe = safeUrl(url);
  if (!safe) return Promise.resolve(null);

  var ctrl = new AbortController();
  var timer = setTimeout(function () { ctrl.abort(); }, 20000);
  var done = function (v) { clearTimeout(timer); return v; };

  return fetch(safe, {
    redirect: 'manual',
    signal: ctrl.signal,
    headers: { 'user-agent': UA, accept: '*/*' }
  }).then(function (res) {
    if (res.status >= 300 && res.status < 400) {
      var loc = res.headers.get('location');
      if (res.body) { try { res.body.cancel(); } catch (_) { /* already gone */ } }
      clearTimeout(timer);
      if (!loc || remaining <= 0) return null;
      var next;
      try { next = new URL(loc, safe).href; } catch (_) { return null; }
      return get(next, remaining - 1);
    }

    if (!res.ok || !res.body) {
      if (res.body) { try { res.body.cancel(); } catch (_) { /* already gone */ } }
      return done(null);
    }

    var reader = res.body.getReader();
    var chunks = [];
    var size = 0;
    var decoder = new TextDecoder('utf-8');

    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return done(chunks.join(''));
        size += r.value.length;
        chunks.push(decoder.decode(r.value, { stream: true }));
        if (size > MAX_BYTES) {
          try { reader.cancel(); } catch (_) { /* already gone */ }
          return done(chunks.join(''));
        }
        return pump();
      });
    }
    return pump();
  }).catch(function () { return done(null); });
}

/** Run promise-returning work one at a time, polite to the origin. */
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
    // Split on ';' and ':' rather than matching declarations with a regex.
    // `/(--[\w-]+)\s*:\s*([^;]+);/g` is quadratic: `[\w-]+` is greedy and
    // contains '-', so a long run of dashes with no ':' backtracks once per
    // start position. A 300KB page of dashes (well under MAX_BYTES) hung the
    // CLI for minutes, and every byte of it is attacker-controlled.
    var decls = m[1].split(';');
    for (var d = 0; d < decls.length; d++) {
      var decl = decls[d];
      var colon = decl.indexOf(':');
      if (colon < 1) continue;
      var k = decl.slice(0, colon).trim();
      if (k.slice(0, 2) !== '--' || k.length > 128) continue;
      if (!(k in target)) target[k] = decl.slice(colon + 1).trim();
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
