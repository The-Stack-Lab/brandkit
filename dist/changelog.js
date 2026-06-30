/**
 * Brandkit Changelog Page
 * Loads config.json → bootstraps theme → renders the version history.
 *
 * A small standalone companion to engine.js: it reuses the same config, the
 * same theme/font bootstrap, and the same escaping, but renders only the
 * changelog (cfg.changelog) so the guide can ship a dedicated history page.
 */
(function () {
  // Base path the page is served from. The build injects
  // window.__BRANDKIT_BASE__ when config.basePath is set (e.g. "/brand"), so a
  // page served from a non-trailing-slash URL still resolves config.json.
  var BASE = (typeof window !== 'undefined' && window.__BRANDKIT_BASE__)
    ? (String(window.__BRANDKIT_BASE__).replace(/\/+$/, '') || '.') : '.';

  fetch(BASE + '/config.json')
    .then(function (res) { return res.json(); })
    .then(function (config) { init(config); })
    .catch(function () { renderError(); });

  /* ================================================================
     Helpers (kept in sync with dist/engine.js — no module system here)
     ================================================================ */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function fontStack(f) {
    if (!f || !f.family) return 'sans-serif';
    function q(s) { return String(s).replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\']/g, '\\$&'); }
    var stack = "'" + q(f.family) + "'";
    if (f.fallback) stack += ", '" + q(f.fallback) + "'";
    return stack + ', sans-serif';
  }

  /* ================================================================
     Bootstrap — fonts + theme variables, mirroring engine.js
     ================================================================ */
  function bootstrap(cfg) {
    if (cfg.fonts) {
      var families = [];
      if (cfg.fonts.display && cfg.fonts.display.googleImport) families.push(cfg.fonts.display.googleImport);
      if (cfg.fonts.body && cfg.fonts.body.googleImport) families.push(cfg.fonts.body.googleImport);
      if (families.length) {
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = 'https://fonts.googleapis.com/css2?family=' + families.join('&family=') + '&display=swap';
        document.head.appendChild(link);
      }
    }

    if (cfg.theme) {
      var vars = [];
      var keys = Object.keys(cfg.theme);
      for (var i = 0; i < keys.length; i++) {
        vars.push('  ' + keys[i] + ': ' + cfg.theme[keys[i]] + ';');
      }
      if (cfg.fonts) {
        if (cfg.fonts.display) vars.push('  --font-display: ' + fontStack(cfg.fonts.display) + ';');
        if (cfg.fonts.body) vars.push('  --font-body: ' + fontStack(cfg.fonts.body) + ';');
      }
      var style = document.createElement('style');
      style.setAttribute('data-brandkit-theme', '');
      style.textContent = ':root {\n' + vars.join('\n') + '\n}';
      document.head.appendChild(style);
    }

    var name = cfg.brand && (cfg.brand.displayName || cfg.brand.name);
    document.title = (name ? name + ' — ' : '') + 'Changelog';
  }

  /* ================================================================
     Render
     ================================================================ */
  function init(cfg) {
    bootstrap(cfg);
    var brand = cfg.brand || {};

    var brandEl = document.getElementById('changelog-brand');
    if (brandEl) brandEl.textContent = brand.displayName || brand.name || 'Brand';

    var leadEl = document.getElementById('changelog-lead');
    if (leadEl) {
      leadEl.textContent = 'A history of every revision to this brand guide — newest first.';
    }

    var list = document.getElementById('changelog-list');
    if (!list) return;

    var entries = cfg.changelog || [];
    if (!entries.length) {
      list.innerHTML = '<div class="changelog-empty">No changelog entries yet. ' +
        'Run <code>brandkit changelog "your update"</code> to add one.</div>';
      return;
    }

    list.innerHTML = entries.map(function (entry) {
      var changes = (entry.changes || []).map(function (c) {
        return '<li>' + esc(c) + '</li>';
      }).join('');
      return (
        '<div class="changelog-entry">' +
          '<div class="changelog-entry-head">' +
            '<span class="changelog-version">v' + esc(entry.version) + '</span>' +
            (entry.date ? '<span class="changelog-date">' + esc(entry.date) + '</span>' : '') +
          '</div>' +
          (changes ? '<ul class="changelog-changes">' + changes + '</ul>' : '') +
        '</div>'
      );
    }).join('');

    var footer = document.getElementById('changelog-footer');
    if (footer) {
      var label = brand.guideLabel || 'Web Style Guide';
      footer.innerHTML = esc((brand.url || '') + (brand.url && brand.byline ? ' · ' : '') + (brand.byline || '')) +
        '<br>' + esc(label) + (brand.version ? ' v' + esc(brand.version) : '');
    }
  }

  function renderError() {
    var list = document.getElementById('changelog-list');
    if (list) {
      list.innerHTML = '<div class="changelog-empty">Could not load config.json. ' +
        'The changelog page needs to be served over HTTP (not opened from a file).</div>';
    }
  }
})();
