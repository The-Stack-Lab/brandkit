/**
 * Ingest orchestrator: one pipeline, several front doors.
 *
 * A source is a URL, a directory, or a file. Whatever it is, it becomes the
 * same evidence shape, and `reconcile` decides what survives into tokens.
 * Adding a front door never changes how tokens are judged.
 */
var fs = require('fs');
var path = require('path');
var sourceDir = require('./source-dir');
var sourceUrl = require('./source-url');
var render = require('./render');
var reconciler = require('./reconcile');
var helpers = require('../generate-helpers');

function classify(source) {
  if (/^https?:\/\//i.test(source)) return 'url';
  // Any other scheme is refused by name, so the reason is legible rather than
  // surfacing as a confusing "not found".
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return 'unsupported-scheme';
  try {
    var st = fs.statSync(path.resolve(source));
    return st.isDirectory() ? 'dir' : 'file';
  } catch (_) { /* fall through to the bare-hostname test */ }

  // A bare hostname is a URL; a mistyped path is not. Without excluding file
  // extensions, `screenshot.png` and `notes.txt` are classified as hosts and
  // fetched as https://screenshot.png instead of reported as missing.
  var looksLikeHost = /^[\w-]+(\.[\w-]+)+(\/|$)/.test(source) &&
    !/\.(png|jpe?g|gif|webp|svg|css|json|md|txt|html?|ya?ml|pdf|zip)$/i.test(source);
  return looksLikeHost ? 'url' : 'missing';
}

/**
 * @param {string[]} sources  URLs, directories, or files
 * @param {object}   opts     { brandName, useRender, log }
 */
function ingest(sources, opts) {
  opts = opts || {};
  var log = opts.log || function () {};
  var results = [];
  var notes = [];

  var chain = sources.reduce(function (p, source) {
    return p.then(function () {
      var kind = classify(source);

      if (kind === 'unsupported-scheme') {
        notes.push('refused (only http/https URLs are fetched): ' + source);
        log('    ! unsupported scheme: ' + source);
        return;
      }

      if (kind === 'missing') {
        notes.push('skipped (not found, and not a URL): ' + source);
        log('    ! not found: ' + source);
        return;
      }

      if (kind === 'dir') {
        log('    scanning directory ' + source);
        var r = sourceDir.ingest(path.resolve(source));
        results.push(r);
        log('      ' + r.screenshots + ' screenshot(s), ' +
            (r.cssVars ? Object.keys(r.cssVars).length : 0) + ' css var(s), ' +
            r.imageCandidates.length + ' image(s)' + (r.claims ? ', found ' + r.claims.file : ''));
        return;
      }

      if (kind === 'file') {
        // Scan only the file itself. Walking its parent directory would pull in
        // whatever else happens to live there, another company's logo, an
        // unrelated theme.css, a stray tokens.json adopted as brand claims:
        // from a folder the user never pointed at.
        log('    reading file ' + source);
        var one = sourceDir.ingestFile(path.resolve(source));
        one.source = source;
        results.push(one);
        log('      ' + (one.cssVars ? Object.keys(one.cssVars).length : 0) + ' css var(s), ' +
            one.fontsDeclared.length + ' font famil(ies), ' +
            one.imageCandidates.length + ' image(s)');
        return;
      }

      var url = /^https?:\/\//i.test(source) ? source : 'https://' + source;

      if (opts.useRender) {
        var probe = render.available();
        if (!probe.ok) {
          notes.push(probe.reason);
          log('    ! --render unavailable, falling back to static fetch');
        } else {
          log('    rendering ' + url + ' in a real browser');
          return render.measure([url], opts).then(function (r) {
            if (r && r.ok) {
              results.push(r);
              log('      measured computed styles, ' + r.fontsRendered.length + ' rendered font(s)');
              return;
            }
            notes.push(r && r.reason ? r.reason : 'render failed');
            log('    ! render failed, falling back to static fetch');
            return staticFetch(url);
          });
        }
      }
      return staticFetch(url);

      function staticFetch(u) {
        log('    fetching ' + u);
        return sourceUrl.ingest(u, opts).then(function (r) {
          results.push(r);
          log('      ' + (r.cssVars ? Object.keys(r.cssVars).length : 0) + ' custom propert(ies), ' +
              r.fontsDeclared.length + ' font famil(ies) declared');
        });
      }
    });
  }, Promise.resolve());

  return chain.then(function () {
    if (!results.length) {
      return {
        tokens: {}, evidence: {}, conflicts: [], rejected: [], gaps: [],
        notes: notes, usable: 0
      };
    }
    var out = reconciler.reconcile(results, opts);
    out.notes = notes.concat(results.reduce(function (a, r) { return a.concat(r.notes || []); }, []));

    // Reconciliation is done with the render captures; drop them now.
    results.forEach(function (r) { if (r.kind === 'render') render.cleanup(r); });

    // A source that resolved but yielded nothing measurable is not a success.
    out.usable = results.filter(function (r) {
      return (r.surfaces && r.surfaces.length) ||
             (r.cssVars && Object.keys(r.cssVars).length) ||
             (r.fontsDeclared && r.fontsDeclared.length) ||
             (r.fontsRendered && r.fontsRendered.length) ||
             (r.imageCandidates && r.imageCandidates.length);
    }).length;
    return out;
  });
}

/**
 * Project reconciled tokens onto brandkit's config fields.
 *
 * Deliberately conservative about surfaces: the guide page itself is a
 * light-chrome document, and `--white`/`--cloud`/`--mist` are the paper it is
 * printed on. A dark brand is *documented*, its surface becomes the header
 * block and a swatch: rather than inverted into the page shell, which would
 * make the guide unreadable rather than on-brand.
 */
function toConfigFields(result, opts) {
  opts = opts || {};
  var t = result.tokens || {};
  var out = { theme: {}, colors: null, fonts: null, logos: null };

  if (t.colors && t.colors.primary) {
    var accent = t.colors.primary;
    out.theme['--accent'] = accent;
    out.theme['--accent-rgb'] = helpers.hexToRgbString(accent);

    // Label color on the fill. Prefer what the brand actually does, a guide
    // documents real usage, and brandkit's accessibility section already
    // surfaces a weak pair as a caution. Only fall back to contrast-
    // maximizing when nothing observed tells us.
    if (t.colors.onPrimary) {
      out.theme['--accent-foreground'] = t.colors.onPrimary;
    } else {
      var onW = parseFloat(helpers.contrastRatio(accent, '#FFFFFF')) || 0;
      var onB = parseFloat(helpers.contrastRatio(accent, '#000000')) || 0;
      out.theme['--accent-foreground'] = onB > onW ? '#000000' : '#FFFFFF';
    }

    // The accent used AS text on light paper is a different job from the fill
    // and must clear 4.5:1 on its own. Darken until it does rather than
    // shipping a value that fails the guide's own contrast table.
    // null means no darkened variant reached 4.5:1, leave the token unset so
    // the stylesheet default applies rather than shipping a failing pair.
    var accentText = darkenUntilReadable(accent, '#FFFFFF', 4.5);
    if (accentText) out.theme['--accent-text'] = accentText;

    // Derive the brand gradient from the measured accent; otherwise the
    // scaffold's placeholder gradient survives and the hero renders in a
    // colour the brand does not own.
    out.theme['--gradient-brand'] =
      'linear-gradient(135deg, ' + darken(accent, 0.22) + ' 0%, ' + accent + ' 100%)';
    out.theme['--gradient-brand-subtle'] =
      'linear-gradient(135deg, rgba(' + helpers.hexToRgbString(accent) + ', 0.06) 0%, rgba(' +
      helpers.hexToRgbString(accent) + ', 0.02) 100%)';
  }

  if (t.colors && t.colors.background && t.colorScheme === 'dark') {
    // The brand's dark surface drives the hero, and ONLY the hero.
    //
    // It must not be written to --ink. Despite the name reading like "the
    // darkest brand color", --ink is brandkit's primary *text* color: 18 of
    // its 24 uses in styles.css are `color:` rules. Assigning a measured
    // background to it made --ink and --header-bg identical, so text rendered
    // at 1.0:1 against its own surface. A measured background may only ever
    // land on a background token.
    out.theme['--header-bg'] = t.colors.background;
  }

  // Carry through any custom properties the site declared itself.
  if (t.theme) {
    Object.keys(t.theme).forEach(function (k) {
      if (!(k in out.theme)) out.theme[k] = t.theme[k];
    });
  }

  if (t.fonts && (t.fonts.body || t.fonts.display)) {
    out.fonts = {};
    ['display', 'body'].forEach(function (role) {
      var fam = t.fonts[role] || t.fonts.body || t.fonts.display;
      if (!fam) return;
      out.fonts[role] = {
        family: fam,
        googleImport: fam.replace(/\s+/g, '+') + ':wght@300;400;500;600;700',
        description: '__TODO: Describe the ' + role + ' font.'
      };
    });
  }

  if (t.logos && t.logos.length) {
    out.logos = t.logos.map(function (l, i) {
      var ext = path.extname(l.rel || l.file || '').slice(1).toLowerCase() || 'png';
      return {
        name: i === 0 ? 'Primary' : 'Variant ' + i,
        description: '__TODO: Describe when to use this mark.',
        variants: (function () { var v = {}; v[ext === 'jpeg' ? 'jpg' : ext] = l.rel || l.file; return v; })(),
        background: 'light'
      };
    });
  }

  // Last line of defence: never hand back a theme whose text and surface
  // collide. Role confusion is easy to reintroduce and invisible in a diff,
  // but trivial to catch by measuring the pair we are about to emit.
  // Only pairs styles.css actually renders together. --ink and --header-bg are
  // deliberately absent: the header's own text is var(--white), so those two
  // never meet, and pairing them here would drop --ink for every dark brand.
  var TEXT_ON = [
    ['--ink', '--white'], ['--ink', '--cloud'],
    ['--accent-text', '--white'], ['--accent-foreground', '--accent']
  ];
  TEXT_ON.forEach(function (pair) {
    var fg = out.theme[pair[0]];
    var bg = out.theme[pair[1]] || BASELINE[pair[1]];
    if (!fg || !bg || !/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) return;
    if ((parseFloat(helpers.contrastRatio(fg, bg)) || 0) < 3) {
      delete out.theme[pair[0]];   // fall back to the stylesheet's own default
      out.dropped = out.dropped || [];
      out.dropped.push(pair[0] + ' vs ' + pair[1] + ' measured below 3:1, left at the default');
    }
  });

  if (!Object.keys(out.theme).length) out.theme = null;
  return out;
}

/** The defaults styles.css ships, for pairs a config may not override. */
var BASELINE = { '--white': '#FFFFFF', '--cloud': '#F9FAFB', '--ink': '#111827' };

/** Multiply a hex toward black by `amount` (0-1). */
function darken(hex, amount) {
  var c = helpers.hexToRgb(hex);
  if (!c) return hex;
  var f = Math.max(0, 1 - amount);
  return '#' + ['r', 'g', 'b'].map(function (k) {
    return ('0' + Math.round(c[k] * f).toString(16)).slice(-2);
  }).join('').toUpperCase();
}

/**
 * Step a color darker until it meets `min` contrast against `bg`.
 * Returns the original when it already passes, or the darkest step tried.
 */
function darkenUntilReadable(hex, bg, min) {
  if ((parseFloat(helpers.contrastRatio(hex, bg)) || 0) >= min) return hex;
  for (var step = 0.08; step <= 0.8; step += 0.08) {
    var candidate = darken(hex, step);
    if ((parseFloat(helpers.contrastRatio(candidate, bg)) || 0) >= min) return candidate;
  }
  // Verify the fallback rather than assuming it clears the bar. Returning an
  // unchecked value here would put a failing color in --accent-text while the
  // function's whole purpose is to guarantee one that passes.
  var last = darken(hex, 0.8);
  return (parseFloat(helpers.contrastRatio(last, bg)) || 0) >= min ? last : null;
}

module.exports = {
  ingest: ingest,
  toConfigFields: toConfigFields,
  classify: classify,
  darken: darken,
  darkenUntilReadable: darkenUntilReadable
};
