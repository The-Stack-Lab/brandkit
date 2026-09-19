/**
 * Brandkit Rendering Engine
 * Loads config.json → bootstraps theme → renders all sections → wires interactivity
 */
(async function () {
  /* ================================================================
     0. Load config
     ================================================================ */
  // Base path the guide is served from. The build injects
  // window.__BRANDKIT_BASE__ when config.basePath is set (e.g. "/brand"), so a
  // guide served from a non-trailing-slash URL still resolves its assets.
  // Default '.' keeps the original page-relative behavior (dev + root serving).
  var BASE = (typeof window !== 'undefined' && window.__BRANDKIT_BASE__)
    ? (String(window.__BRANDKIT_BASE__).replace(/\/+$/, '') || '.') : '.';

  // Resolve a config-relative asset path (logo variants, brand.headerLogo/
  // sidebarLogo) against BASE. Without this, a guide served from a base path
  // with no trailing slash (e.g. /brand, not /brand/) resolves "logos/x.svg"
  // relative to /brand -> /logos/x.svg -> 404. Absolute and data: URIs pass
  // through untouched. Used for every <img> src and download href built from a
  // config path so previews and downloads behave the same under a basePath.
  function assetUrl(file) {
    if (!file) return file;
    if (/^([a-z]+:)?\/\//i.test(file) || file.indexOf('data:') === 0) return file;
    return (BASE && BASE !== '.') ? BASE + '/' + file.replace(/^\/+/, '') : file;
  }

  // Reveal the FOUC-gated shell. index.html hides .layout (opacity:0) until this
  // runs, so the default theme never flashes before the real brand paints. The
  // class is added once the first render pass below completes. Idempotent.
  function reveal() { document.documentElement.classList.add('bk-ready'); }
  // Failsafe registered BEFORE the fetch: if config.json is slow or fails, never
  // leave the page permanently blank: reveal after 1.5s no matter what. The
  // finally below clears this on the normal path so it doesn't fire twice.
  var revealFailsafe = setTimeout(reveal, 1500);

  try {
    var res = await fetch(BASE + '/config.json');
    // Guard before parsing: a non-200 response (e.g. a CDN/error page served
    // with a JSON body) would otherwise flow straight into init() and render
    // confusing output instead of failing cleanly.
    if (!res.ok) throw new Error('Failed to load config.json: ' + res.status);
    var config = await res.json();
    init(config);
  } finally {
    // Reveal after init()'s synchronous render pass (or on error, so a failed
    // load shows the page rather than a blank frame). The throw still surfaces
    // as an unhandled rejection for debugging, finally doesn't swallow it.
    clearTimeout(revealFailsafe);
    reveal();
  }

  function init(cfg) {
    var copyFormat = localStorage.getItem('brandkit-copy-format') || 'hex';

    /* ==============================================================
       HTML escape helper: prevents XSS from config values
       ============================================================== */
    function esc(s) {
      return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /**
     * Is this value still unfilled? Mirrors isUnset() in lib/export.js.
     *
     * `__TODO:` markers are internal signals written by `generate`. Rendering
     * one puts a maintainer instruction on the page a client is asked to
     * approve, so an unfilled value is shown as an explicit empty state instead.
     */
    function isUnset(v) {
      if (v === null || v === undefined) return true;
      if (typeof v !== 'string') return false;
      var t = v.trim();
      return t === '' || t.indexOf('__TODO') === 0;
    }

    /** Text if filled, else '': for inline use where an empty string is fine. */
    function orBlank(v) {
      return isUnset(v) ? '' : v;
    }

    /**
     * Fill a text node, or show a muted "not yet defined" placeholder. The
     * element is hidden entirely when there is nothing to say and no label.
     */
    function setOrPlaceholder(el, value, label) {
      if (!el) return;
      if (!isUnset(value)) {
        el.textContent = value;
        el.removeAttribute('data-brandkit-unset');
        el.hidden = false;
        return;
      }
      // Every current call site passes a label; kept so a future caller can
      // hide an element outright rather than showing an empty placeholder.
      if (!label) { el.hidden = true; return; }
      el.textContent = label;
      el.setAttribute('data-brandkit-unset', '');
      el.hidden = false;
    }

    /* ==============================================================
       Font stack helper: weaves in an optional `fallback` web stand-in
       for brands whose official typeface isn't web-available:
         'Family', 'Fallback', sans-serif
       No fallback → 'Family', sans-serif (backward-compatible).
       ============================================================== */
    function fontStack(f) {
      if (!f || !f.family) return 'sans-serif';
      // Strip control chars (a raw newline ends a CSS string) then escape
      // backslash + single-quote, so a config value can't break out of the
      // quoted CSS string and inject rules into the injected :root block.
      function q(s) { return String(s).replace(/[\u0000-\u001F\u007F]/g, '').replace(/[\\']/g, '\\$&'); }
      var stack = "'" + q(f.family) + "'";
      if (f.fallback) stack += ", '" + q(f.fallback) + "'";
      return stack + ', sans-serif';
    }

    /* ==============================================================
       CSS-value sanitizer: strips the characters a config value would
       need to break out of the injected <style> block ( < > ), out of the
       :root {…} rule ( { } ), or out of its own declaration to smuggle in
       another one ( ; ). A legitimate custom-property token/value never
       contains them, so real configs pass through unchanged; an
       adversarial value like "}</style><script>..." or
       "red; background-image:url(x)" is defanged.
       ============================================================== */
    function stripComments(v) {
      // One pass is not enough: removing a delimiter can join its neighbours
      // into a new one ("//**" -> "/*"), which is the injection this exists
      // to stop. Repeat to a fixed point; each pass only shortens.
      var out = String(v), prev;
      do { prev = out; out = out.replace(/\/\*|\*\//g, ''); } while (out !== prev);
      return out;
    }
    function cssVal(v) { return stripComments(String(v == null ? '' : v).replace(/[<>{};]/g, '')); }

    /* A property NAME, not a value: strips whitespace, comment delimiters and
       every CSS delimiter. `/*` + `*\/` around a key is invisible to the value
       sanitizer but invisible to the CSS parser too, so `/**\/--bk-ui-bg` was
       emitted and read back as --bk-ui-bg. Normalizing here means the guard
       tests the name the browser will actually see. */
    function cssKey(k) { return String(k == null ? '' : k).replace(/[\u0000-\u0020<>{}();:,'"\\\/*\[\]]/g, ''); }


    /* ==============================================================
       Reserved chrome namespace: `--bk-*` tokens style brandkit's own
       UI (the sidebar, the controls, toasts), not the brand. They are
       dropped from the injected :root so a theme can never repaint the
       tool with the brand it documents. Mirrors isChromeToken() in
       lib/template.js.
       ============================================================== */
    // Tested AFTER the same strip cssVal() applies: "--b;k-ui-font" is not
    // --bk-* as written but becomes --bk-ui-font once emitted.
    /* A CSS custom-property name, reduced to characters one can legally
       contain. This value is interpolated into a style attribute, where
       esc() alone would still allow `--ink);" onmouseover=`. */
    function cssVarName(v) { return String(v == null ? '' : v).replace(/[^-\w]/g, ''); }

    function isChromeToken(key) { return /^--bk-/i.test(cssKey(key)); }


    /* ==============================================================
       BOOTSTRAP: inject fonts + CSS variables before any rendering
       ============================================================== */
    function bootstrap() {
      // Inject Google Fonts
      if (cfg.fonts) {
        // Dedupe families: when display and body share a font (e.g. both
        // Inter), requesting it once avoids a redundant URL + duplicate
        // font CSS work.
        var seen = {};
        var families = [];
        function addFamily(f) {
          if (f && f.googleImport && !seen[f.googleImport]) {
            seen[f.googleImport] = 1;
            families.push(f.googleImport);
          }
        }
        addFamily(cfg.fonts.display);
        addFamily(cfg.fonts.body);
        if (families.length) {
          // One <link> per family: a single unsatisfiable family would
          // otherwise 400 the combined request and drop BOTH fonts.
          families.forEach(function (fam) {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=' + fam + '&display=swap';
            document.head.appendChild(link);
          });
        }
      }

      // Inject CSS custom properties from theme.
      // Not gated on cfg.theme: a config with fonts and no theme must inject
      // the font vars here too, or dev previews the baseline face while the
      // build (lib/template.js, which emits them unconditionally) ships the
      // brand's.
      var vars = [];
      if (cfg.theme) {
        var keys = Object.keys(cfg.theme);
        for (var i = 0; i < keys.length; i++) {
          if (isChromeToken(keys[i])) continue;
          vars.push('  ' + cssKey(keys[i]) + ': ' + cssVal(cfg.theme[keys[i]]) + ';');
        }
      }
      if (cfg.fonts) {
        if (cfg.fonts.display) vars.push('  --font-display: ' + fontStack(cfg.fonts.display) + ';');
        if (cfg.fonts.body) vars.push('  --font-body: ' + fontStack(cfg.fonts.body) + ';');
      }
      if (vars.length) {
        var style = document.createElement('style');
        style.setAttribute('data-brandkit-theme', '');
        style.textContent = ':root {\n' + vars.join('\n') + '\n}';
        document.head.appendChild(style);
      }

      // Set page title
      if (cfg.brand && cfg.brand.displayName) {
        document.title = cfg.brand.displayName + ': Brand Guide';
      }
    }

    /* ==============================================================
       1. Toast
       ============================================================== */
    function toast(message) {
      var container = document.getElementById('toast-container');
      if (!container) return;
      var el = document.createElement('div');
      el.className = 'toast';
      el.innerHTML =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>' +
        '</svg>' +
        message;
      container.appendChild(el);
      setTimeout(function () {
        el.classList.add('out');
        setTimeout(function () { el.remove(); }, 200);
      }, 2000);
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied: ' + (text.length > 50 ? text.slice(0, 47) + '...' : text));
      } catch (_) {
        toast('Copy failed: try from localhost or HTTPS');
      }
    }

    /* ==============================================================
       Optional sections (logo usage, formats) exist only when the config
       defines them. A config written before they existed has no nav entry
       for them, so adopting the fields would render a section nothing
       links to. Add the link unless the author already placed one.
       ============================================================== */
    function navWithOptionalSections(nav) {
      function hasId(id) {
        return nav.some(function (g) {
          return (g.items || []).some(function (it) { return it.id === id; });
        });
      }
      var groups = nav.map(function (g) { return { group: g.group, items: (g.items || []).slice() }; });
      var logosAt = -1;
      groups.forEach(function (g, i) {
        g.items.forEach(function (it) { if (it.id === 'logos') logosAt = i; });
      });
      if (hasLogoUsage() && !hasId('logo-usage')) {
        if (logosAt !== -1) groups[logosAt].items.push({ label: 'Usage', id: 'logo-usage' });
        else groups.push({ group: 'Logos', items: [{ label: 'Usage', id: 'logo-usage' }] });
      }
      if (resolvedFormats().length && !hasId('formats')) {
        var entry = { group: 'Formats', items: [{ label: 'Canvas Specs', id: 'formats' }] };
        if (logosAt !== -1) groups.splice(logosAt + 1, 0, entry);
        else groups.push(entry);
      }
      return groups;
    }

    /* ==============================================================
       2. Render navigation
       ============================================================== */
    function renderNav() {
      var navEl = document.getElementById('nav');
      if (!navEl || !cfg.nav) return;
      navEl.innerHTML = navWithOptionalSections(cfg.nav).map(function (group) {
        var header = '<li class="nav-group">' + esc(group.group) + '</li>';
        var items = group.items.map(function (item) {
          return '<li class="nav-group-items"><a href="#' + esc(item.id) + '">' + esc(item.label) + '</a></li>';
        }).join('');
        return header + items;
      }).join('');
    }

    /* ==============================================================
       2b. Render agent callout: a paste-ready prompt that points an AI
       agent at the machine-readable exports (brand.json / tokens.json /
       brand.md) so it reads structured brand data instead of scraping the
       rendered page. Opt out with brand.agentCallout === false.
       ============================================================== */
    function renderAgentCallout() {
      var box = document.getElementById('agent-callout');
      if (!box) return;
      if (cfg.brand && cfg.brand.agentCallout === false) return;

      // Resolve export URLs relative to this page exactly as a link would, so
      // the pasted prompt carries absolute URLs the agent can fetch directly.
      // Clear any userinfo so basic-auth creds in the page URL don't leak into
      // the copied prompt (a relative path already drops the page query/hash).
      function exportUrl(file) {
        // When served from a base path, resolve against it so the prompt
        // carries the real export URLs (page URL may have no trailing slash).
        var ref = (BASE && BASE !== '.') ? BASE + '/' + file : file;
        var u = new URL(ref, location.href);
        u.username = ''; u.password = '';
        return u.href;
      }
      var brandUrl, tokensUrl, mdUrl;
      try {
        brandUrl = exportUrl('brand.json');
        tokensUrl = exportUrl('tokens.json');
        mdUrl = exportUrl('brand.md');
      } catch (_) {
        brandUrl = 'brand.json'; tokensUrl = 'tokens.json'; mdUrl = 'brand.md';
      }
      // Strip control chars / newlines and collapse whitespace so a hostile
      // brand name can't smuggle instructions into the paste-ready agent prompt.
      var name = ((cfg.brand && (cfg.brand.displayName || cfg.brand.name)) || 'this brand')
        .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g, ' ').replace(/\s+/g, ' ').trim() || 'this brand';
      var prompt =
        'This page is a brandkit brand guide for ' + name + '. It publishes ' +
        'machine-readable brand data. Read these instead of scraping the page:\n\n' +
        '- ' + brandUrl + ' (full structured brand: colors with roles and contrast, typography, voice, logos, spacing)\n' +
        '- ' + tokensUrl + ' (W3C design tokens, DTCG $type/$value, for code and design tooling)\n' +
        '- ' + mdUrl + ' (brand brief: how to stay on-brand)\n\n' +
        'Fetch them, then apply ' + name + "'s colors, type, and voice to what you're building.";

      box.innerHTML =
        '<div class="sidebar-agent-title">Using an AI agent?</div>' +
        '<p class="sidebar-agent-desc">Paste this so it reads the brand data, not the page.</p>' +
        '<button type="button" class="sidebar-agent-btn" id="agent-callout-btn">Copy agent prompt</button>';
      // Set the payload via property (not an HTML attribute) so no font/brand
      // value needs escaping and newlines survive intact.
      var btn = box.querySelector('#agent-callout-btn');
      if (btn) btn.dataset.copy = prompt;
      box.hidden = false;
    }

    /* ==============================================================
       2c. Render changelog link: pinned to the bottom of the sidebar when
       a changelog exists, pointing at the standalone changelog.html page.
       ============================================================== */
    function renderChangelogLink() {
      var link = document.getElementById('sidebar-changelog');
      if (!link) return;
      if (!cfg.changelog || !cfg.changelog.length) return;

      // Resolve against BASE so the link works when the guide is served from a
      // non-trailing-slash base path (e.g. /brand → /brand/index.html).
      var href = (BASE && BASE !== '.') ? BASE + '/changelog.html' : 'changelog.html';
      link.setAttribute('href', href);
      link.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">' +
          '<path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 2"/>' +
          '<circle cx="12" cy="12" r="9"/>' +
        '</svg>' +
        '<span class="sidebar-changelog-label">Changelog</span>' +
        '<span class="sidebar-changelog-version">v' + esc((cfg.brand && cfg.brand.version) || '') + '</span>';
      link.hidden = false;
    }

    /* ==============================================================
       3. Render colors
       ============================================================== */
    function renderColorGrid(colors, containerId) {
      var container = document.getElementById(containerId);
      if (!container) return;
      if (!colors || !colors.length) {
        container.innerHTML = '<div class="empty-state">No colors configured</div>';
        return;
      }
      container.innerHTML = colors.map(function (c) {
        // Field aliases for resilience
        var name = c.name || c.label || '';
        var hex = c.hex || '';
        var oklch = c.oklch || '';
        var cssVar = c.cssVar || c.token || '';
        var role = c.role || c.usage || '';
        var isLight = c.light || (hex && parseInt(hex.slice(1), 16) > 0xAAAAAA);
        // Hex and oklch stack rather than sitting on one · separated line:
        // in the monospace data font the pair is wider than a swatch column,
        // and a wrapped line breaks mid-token ("0.05 / 274)"). One copy
        // target either way, still carrying the hex.
        var valueDisplay = '<span class="color-value-hex">' + esc(hex) + '</span>' +
          (oklch ? '<span class="color-value-oklch">' + esc(oklch) + '</span>' : '');
        return (
          '<div class="color-card">' +
            '<div class="color-swatch copyable ' + (isLight ? 'has-border' : '') + '"' +
              ' style="background:' + esc(hex) + ';"' +
              ' data-hex="' + esc(hex) + '"' +
              ' data-oklch="' + esc(oklch) + '"' +
              ' data-css-var="' + esc(cssVar) + '"' +
              ' tabindex="0" role="button" aria-label="Copy ' + esc(name) + ' color value">' +
              '<div class="copy-hint"><span>Click to copy</span></div>' +
            '</div>' +
            '<div class="color-name">' + esc(name) + '</div>' +
            '<div class="color-value copyable" data-copy="' + esc(hex) + '">' + valueDisplay + '</div>' +
            '<div class="color-role">' + esc(role) + '</div>' +
          '</div>'
        );
      }).join('');
    }

    function renderColors() {
      if (!cfg.colors) return;
      // Support both { label, items } objects and plain arrays
      var groups = ['brand', 'neutrals', 'semantic'];
      groups.forEach(function (key) {
        var group = cfg.colors[key];
        if (!group) return;
        var items = group.items || group;
        var label = group.label || key.charAt(0).toUpperCase() + key.slice(1);
        // Set the group label if the container's preceding label exists
        var labelEl = document.getElementById('colors-' + key + '-label');
        if (labelEl) labelEl.textContent = label;
        renderColorGrid(items, 'colors-' + key);
      });
    }

    /* ==============================================================
       4. Render gradients
       ============================================================== */
    function renderGradients() {
      var gradientsSection = document.getElementById('gradients');
      // No gradient configured → hide the whole section. The swatches are
      // CSS-backed (var(--gradient-brand)), so leaving the scaffolding would
      // render the default gradient under an empty "Gradient System" header.
      if (!cfg.gradients || !cfg.gradients.length) {
        if (gradientsSection) gradientsSection.style.display = 'none';
        return;
      }
      if (gradientsSection) gradientsSection.style.display = '';

      var stopsContainer = document.getElementById('gradient-stops');
      if (!stopsContainer) return;
      var brand = cfg.gradients[0];
      if (brand && brand.stops && brand.stops.length) {
        stopsContainer.innerHTML = brand.stops.map(function (s) {
          return (
            '<div class="gradient-stop">' +
              '<div class="gradient-stop-dot" style="background:' + s.color + ';"></div>' +
              s.name + ' \u00B7 ' + s.position +
            '</div>'
          );
        }).join('');
      }
    }

    /* ==============================================================
       5. Render logos
       ============================================================== */
    function renderLogos() {
      var grid = document.getElementById('logos-grid');
      if (!grid) return;
      if (!cfg.logos || !cfg.logos.length) {
        grid.innerHTML = '<div class="empty-state">No logos configured. Add logo files to the logos/ directory and update config.json.</div>';
        return;
      }

      var downloadIcon =
        '<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
        '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4v12m0 0l-4-4m4 4l4-4M4 18h16"/>' +
        '</svg>';

      grid.innerHTML = cfg.logos.map(function (logo, idx) {
        // Determine background class
        var bgClass = '';
        var bgStyle = '';
        if (logo.background === 'light') {
          bgClass = 'on-light';
          bgStyle = 'background:#FFFFFF; border:1px solid var(--mist);';
        } else if (logo.background === 'dark') {
          bgClass = 'on-dark';
          bgStyle = 'background:var(--ink);';
        } else if (logo.background === 'gradient') {
          bgClass = 'on-gradient';
          bgStyle = 'background:var(--gradient-brand);';
        }

        // Available formats
        var formats = Object.keys(logo.variants);
        var firstFormat = formats[0] || 'svg';

        // Preview image: use svg first, then png, then jpg
        var previewSrc = logo.variants.svg || logo.variants.png || logo.variants.jpg || '';

        // Format toggle buttons
        var formatToggles = formats.map(function (fmt, fi) {
          return (
            '<button class="logo-format-btn' + (fi === 0 ? ' active' : '') + '"' +
            ' data-logo-idx="' + idx + '"' +
            ' data-format="' + fmt + '">' +
            fmt.toUpperCase() +
            '</button>'
          );
        }).join('');

        // Size picker (only visible for raster formats)
        var sizeOptions = (cfg.logoSizes || []).map(function (s) {
          return '<option value="' + (s.width || '') + '">' + s.label + '</option>';
        }).join('');

        var isFirstRaster = (firstFormat !== 'svg');

        var sizePicker =
          '<select class="logo-size-picker" data-logo-idx="' + idx + '"' +
          (isFirstRaster ? '' : ' style="display:none;"') + '>' +
          sizeOptions +
          '</select>';

        return (
          '<div class="logo-card ' + bgClass + '" style="' + bgStyle + '" data-logo-idx="' + idx + '">' +
            '<img src="' + esc(assetUrl(previewSrc)) + '" alt="' + logo.name + '">' +
            '<div class="logo-name">' + logo.name + '</div>' +
            '<div class="logo-description">' + esc(orBlank(logo.description)) + '</div>' +
            '<div class="logo-controls">' +
              '<div class="logo-format-toggle">' + formatToggles + '</div>' +
              sizePicker +
              '<button class="logo-download-btn" data-logo-idx="' + idx + '">' +
                downloadIcon + ' Download' +
              '</button>' +
            '</div>' +
          '</div>'
        );
      }).join('');

      // Wire up format toggles
      grid.addEventListener('click', function (e) {
        var fmtBtn = e.target.closest('.logo-format-btn');
        if (fmtBtn) {
          var card = fmtBtn.closest('.logo-card');
          card.querySelectorAll('.logo-format-btn').forEach(function (b) {
            b.classList.toggle('active', b === fmtBtn);
          });
          var picker = card.querySelector('.logo-size-picker');
          if (picker) {
            picker.style.display = (fmtBtn.dataset.format === 'svg') ? 'none' : '';
          }
          return;
        }

        // Download button
        var dlBtn = e.target.closest('.logo-download-btn');
        if (dlBtn) {
          var logoIndex = parseInt(dlBtn.dataset.logoIdx, 10);
          var logoData = cfg.logos[logoIndex];
          var cardEl = dlBtn.closest('.logo-card');

          var activeBtn = cardEl.querySelector('.logo-format-btn.active');
          var format = activeBtn ? activeBtn.dataset.format : Object.keys(logoData.variants)[0];

          var filePath = logoData.variants[format];
          if (!filePath) return;
          // Resolve against BASE so downloads work under a non-trailing-slash
          // basePath, exactly as the previews above do.
          filePath = assetUrl(filePath);

          var slug = cfg.brand.name || 'brand';
          var namePart = logoData.name.toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

          if (format === 'svg') {
            triggerDirectDownload(filePath, slug + '-' + namePart + '.svg');
            return;
          }

          var sizePicker2 = cardEl.querySelector('.logo-size-picker');
          var targetWidth = sizePicker2 ? parseInt(sizePicker2.value, 10) : NaN;

          if (!targetWidth || isNaN(targetWidth)) {
            var ext = format === 'png' ? '.png' : '.jpg';
            triggerDirectDownload(filePath, slug + '-' + namePart + ext);
          } else {
            resizeAndDownload(filePath, format, targetWidth, slug + '-' + namePart + '-' + targetWidth + 'px');
          }
        }
      });
    }

    function triggerDirectDownload(href, filename) {
      var a = document.createElement('a');
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function resizeAndDownload(src, format, targetWidth, filenameBase) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        var ratio = img.naturalHeight / img.naturalWidth;
        var targetHeight = Math.round(targetWidth * ratio);
        var canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        var ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
        var mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
        var ext = format === 'png' ? '.png' : '.jpg';
        canvas.toBlob(function (blob) {
          if (!blob) return;
          var url = URL.createObjectURL(blob);
          triggerDirectDownload(url, filenameBase + ext);
          setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
        }, mimeType, 0.92);
      };
      img.onerror = function () {
        toast('Failed to load image for resize');
      };
      img.src = src;
    }

    /* ==============================================================
       5b. Logo usage + 5c. Formats: the rules for output that is not a web
       page. Both sections stay hidden unless the config defines them.

       FORMAT_PRESETS mirrors lib/formats.js (no module system here), keep
       the two in sync.
       ============================================================== */
    var FORMAT_PRESETS = {
      'social-square':   { name: 'Social square (1:1)',            kind: 'social',       width: 1080, height: 1080, unit: 'px' },
      'social-portrait': { name: 'Social portrait (4:5)',          kind: 'social',       width: 1080, height: 1350, unit: 'px' },
      'social-story':    { name: 'Story or vertical video (9:16)', kind: 'social',       width: 1080, height: 1920, unit: 'px' },
      'link-card':       { name: 'Link preview card',              kind: 'social',       width: 1200, height: 630,  unit: 'px' },
      'slide-16x9':      { name: 'Slide 16:9',                     kind: 'presentation', width: 1920, height: 1080, unit: 'px' }
    };
    var PRESET_ALIASES = {
      '1080x1080': 'social-square', '1080x1350': 'social-portrait', '1080x1920': 'social-story',
      '1200x630': 'link-card', '1920x1080': 'slide-16x9'
    };
    var FORMAT_KINDS = ['social', 'presentation', 'video', 'print', 'other'];

    // A hand-edited config can hold `"logos": {}`. The nav runs for every
    // config, so it must never assume a list.
    function logoList() { return Array.isArray(cfg.logos) ? cfg.logos : []; }

    function resolvedFormats() {
      if (!Array.isArray(cfg.formats)) return [];
      return cfg.formats.map(function (entry) {
        if (typeof entry === 'string') entry = isUnset(entry) ? null : { preset: entry };
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
        var out = {};
        if (!isUnset(entry.preset)) {
          var k = typeof entry.preset === 'string' ? entry.preset.trim().toLowerCase().replace(/\s+/g, '') : '';
          if (PRESET_ALIASES[k]) k = PRESET_ALIASES[k];
          var preset = Object.prototype.hasOwnProperty.call(FORMAT_PRESETS, k) ? FORMAT_PRESETS[k] : null;
          if (preset) { out.preset = k; Object.keys(preset).forEach(function (p) { out[p] = preset[p]; }); }
          else out.unknownPreset = String(entry.preset);
        }
        Object.keys(entry).forEach(function (p) {
          if (p !== 'preset' && p !== '__proto__' && !isUnset(entry[p])) out[p] = entry[p];
        });
        if (typeof out.unit !== 'string') delete out.unit;
        if (out.unit === undefined && (out.width !== undefined || out.height !== undefined)) out.unit = 'px';
        if (out.kind !== undefined && FORMAT_KINDS.indexOf(out.kind) === -1) out.kind = 'other';
        return out;
      }).filter(function (f) {
        // An entry with no canvas and no name is not a format. Without this an
        // empty `{}` revealed the section and drew a blank card.
        if (f === null) return false;
        var hasDims = typeof f.width === 'number' && typeof f.height === 'number';
        return hasDims || (typeof f.name === 'string' && !isUnset(f.name)) || !!f.unknownPreset;
      });
    }

    function safeZoneOf(fmt) {
      var z = fmt.safeZone;
      if (z === undefined || z === null || z === '') return null;
      if (typeof z !== 'number' && (typeof z !== 'object' || Array.isArray(z))) return null;
      var all = typeof z === 'number' ? z : (typeof z.all === 'number' ? z.all : null);
      if (all !== null && all < 0) all = null;
      var src = typeof z === 'object' ? z : {};
      var out = {}, any = all !== null;
      ['top', 'right', 'bottom', 'left'].forEach(function (side) {
        if (typeof src[side] === 'number' && src[side] >= 0) { out[side] = src[side]; any = true; }
        else out[side] = all !== null ? all : 0;
      });
      if (!any) return null;
      out.unit = (typeof src.unit === 'string' && !isUnset(src.unit)) ? src.unit
        : (typeof fmt.unit === 'string' && !isUnset(fmt.unit)) ? fmt.unit : 'px';
      return out;
    }

    function usageOf(src) {
      if (!src || typeof src !== 'object') return null;
      var cs = src.clearSpace;
      if (typeof cs === 'string') cs = { rule: cs };
      var rows = [];
      // Same two tests as normalizeClearSpace() in lib/formats.js.
      var csRule = (cs && typeof cs === 'object' && typeof cs.rule === 'string' && !isUnset(cs.rule)) ? cs.rule : '';
      var csRatio = (cs && typeof cs === 'object' && typeof cs.ratio === 'number' && cs.ratio > 0) ? cs.ratio : null;
      if (csRule || csRatio !== null) {
        rows.push(['Clear space', csRule +
          (csRatio !== null ? (csRule ? ' (' : '') + csRatio + '\u00D7 the logo height' + (csRule ? ')' : '') : '')]);
      }
      var min = src.minSize || {};
      var sizes = [];
      if (typeof min.digitalPx === 'number' && min.digitalPx > 0) sizes.push(min.digitalPx + 'px on screen');
      if (typeof min.printMm === 'number' && min.printMm > 0) sizes.push(min.printMm + 'mm in print');
      if (sizes.length) rows.push(['Minimum width', sizes.join(' \u00B7 ')]);
      // Rules are sentences. An object here would print as "[object Object]".
      function isText(x) { return (typeof x === 'string' || typeof x === 'number') && !isUnset(x); }
      var placement = [].concat(src.placement || []).filter(isText);
      if (placement.length) rows.push(['Placement', placement.join(' \u00B7 ')]);
      var dont = [].concat(src.dont || []).filter(isText);
      return (rows.length || dont.length) ? { rows: rows, dont: dont } : null;
    }

    function hasLogoUsage() {
      if (usageOf(cfg.logoUsage)) return true;
      return logoList().some(function (l) { return !!usageOf(l); });
    }

    function usageCard(title, u) {
      var html = '<div class="usage-card">';
      if (title) html += '<div class="usage-card-title">' + esc(title) + '</div>';
      if (u.rows.length) {
        html += '<dl class="spec-list">' + u.rows.map(function (r) {
          return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
        }).join('') + '</dl>';
      }
      if (u.dont.length) {
        html += '<div class="usage-dont"><h4>Never</h4><ul>' + u.dont.map(function (d) {
          return '<li>' + esc(d) + '</li>';
        }).join('') + '</ul></div>';
      }
      return html + '</div>';
    }

    function renderLogoUsage() {
      var section = document.getElementById('logo-usage');
      var container = document.getElementById('logo-usage-content');
      if (!section || !container || !hasLogoUsage()) return;
      var html = '';
      var brandWide = usageOf(cfg.logoUsage);
      if (brandWide) html += usageCard(logoList().length > 1 ? 'All logos' : '', brandWide);
      logoList().forEach(function (l) {
        var own = usageOf(l);
        if (own) html += usageCard(isUnset(l.name) ? 'Logo' : l.name, own);
      });
      container.innerHTML = html;
      section.hidden = false;
    }

    // Where the logo chip sits inside the safe zone preview.
    function placementStyle(placement) {
      var p = String(placement || '').toLowerCase();
      var v = p.indexOf('top') !== -1 ? 'top:0;' : p.indexOf('bottom') !== -1 ? 'bottom:0;' : 'top:50%;';
      var h = p.indexOf('left') !== -1 ? 'left:0;' : p.indexOf('right') !== -1 ? 'right:0;' : 'left:50%;';
      var tx = h === 'left:50%;' ? '-50%' : '0', ty = v === 'top:50%;' ? '-50%' : '0';
      return v + h + 'transform:translate(' + tx + ',' + ty + ');';
    }

    function renderFormats() {
      var section = document.getElementById('formats');
      var grid = document.getElementById('formats-grid');
      var formats = resolvedFormats();
      if (!section || !grid || !formats.length) return;

      grid.innerHTML = formats.map(function (f) {
        var unit = f.unit || 'px';
        var hasDims = typeof f.width === 'number' && typeof f.height === 'number' && f.width > 0 && f.height > 0;
        var zone = safeZoneOf(f);
        var logo = (f.logo && typeof f.logo === 'object' && !Array.isArray(f.logo)) ? f.logo
          : (typeof f.logo === 'string' && !isUnset(f.logo)) ? { placement: f.logo } : null;
        // Decided before the preview is drawn: a logo entry that says nothing
        // gets no row and no chip.
        var logoBits = logo ? [logo.variant, logo.placement,
          typeof logo.maxWidth === 'number' ? 'max ' + logo.maxWidth + unit : null, logo.note]
          .filter(function (x) { return typeof x === 'string' && !isUnset(x); }) : [];
        if (!logoBits.length) logo = null;
        var preview = '';
        if (hasDims) {
          var pct = function (n, of) { return Math.max(0, Math.min(45, (n / of) * 100)).toFixed(2) + '%'; };
          var drawZone = zone && zone.unit === unit;
          var inset = drawZone
            ? 'top:' + pct(zone.top, f.height) + ';right:' + pct(zone.right, f.width) +
              ';bottom:' + pct(zone.bottom, f.height) + ';left:' + pct(zone.left, f.width) + ';'
            : 'top:0;right:0;bottom:0;left:0;';
          // Tall canvases are capped by height, wide ones by width.
          var boxWidth = Math.round(Math.min(220, 220 * (f.width / f.height)));
          preview =
            '<div class="format-preview" style="width:' + boxWidth + 'px;aspect-ratio:' + f.width + ' / ' + f.height + ';">' +
              '<div class="format-safe' + (drawZone ? '' : ' none') + '" style="' + inset + '">' +
                (logo ? '<span class="format-logo-chip" style="' + placementStyle(logo.placement) + '">Logo</span>' : '') +
              '</div>' +
            '</div>';
        }

        var rows = [];
        if (hasDims) rows.push(['Canvas', f.width + ' \u00D7 ' + f.height + ' ' + unit]);
        else if (f.unknownPreset) rows.push(['Canvas', 'Unknown preset "' + f.unknownPreset + '"']);
        if (zone) {
          var even = zone.top === zone.right && zone.right === zone.bottom && zone.bottom === zone.left;
          rows.push(['Safe zone', even ? zone.top + zone.unit + ' on every side'
            : zone.top + ' / ' + zone.right + ' / ' + zone.bottom + ' / ' + zone.left + ' ' + zone.unit + ' (top, right, bottom, left)']);
        }
        if (logoBits.length) rows.push(['Logo', logoBits.join(' \u00B7 ')]);
        if (f.typography && typeof f.typography === 'object' && !Array.isArray(f.typography)) {
          Object.keys(f.typography).forEach(function (role) {
            var t = f.typography[role];
            if (typeof t === 'string') t = { style: t };
            if (!t || isUnset(t.style)) return;
            rows.push([role.charAt(0).toUpperCase() + role.slice(1), t.style + (isUnset(t.size) ? '' : ' at ' + t.size)]);
          });
        }
        var bgs = [].concat(f.background || []).map(function (b) {
          if (b && typeof b === 'object') {
            return [b.color || b.note || b.type, b.overlay ? 'with ' + b.overlay : null]
              .filter(function (x) { return !isUnset(x); }).join(' ');
          }
          return isUnset(b) ? '' : String(b);
        }).filter(Boolean);
        if (bgs.length) rows.push(['Backgrounds', bgs.join(' \u00B7 ')]);

        return (
          '<div class="format-card">' +
            '<div class="format-preview-wrap">' + preview + '</div>' +
            '<div class="format-body">' +
              '<div class="format-name">' + esc(isUnset(f.name) ? 'Format' : f.name) +
                (f.kind ? '<span class="format-kind">' + esc(f.kind) + '</span>' : '') + '</div>' +
              '<dl class="spec-list">' + rows.map(function (r) {
                return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>';
              }).join('') + '</dl>' +
              (isUnset(f.notes) ? '' : '<p class="format-notes">' + esc(f.notes) + '</p>') +
            '</div>' +
          '</div>'
        );
      }).join('');
      section.hidden = false;
    }

    /* ==============================================================
       6. Render typography
       ============================================================== */
    function renderTypography() {
      var typeScale = document.getElementById('type-scale');
      if (!typeScale) return;
      if (!cfg.typography || !cfg.typography.length) {
        typeScale.innerHTML = '<div class="empty-state">No type scale configured</div>';
        return;
      }

      typeScale.innerHTML = cfg.typography.map(function (t) {
        var family = t.font === 'display'
          ? cfg.fonts.display.family
          : cfg.fonts.body.family;

        var specParts = [t.size, t.weight, t.tracking !== '0' ? t.tracking : null, t.leading ? t.leading + ' leading' : null, family].filter(Boolean);

        var displaySize = Math.min(parseInt(t.size, 10), 48);
        var inlineStyle =
          "font-family:'" + family + "',sans-serif;" +
          'font-size:' + displaySize + 'px;' +
          'font-weight:' + t.weight + ';' +
          'letter-spacing:' + t.tracking + ';' +
          'line-height:' + t.leading + ';' +
          (t.uppercase ? 'text-transform:uppercase;' : '') +
          (t.name === 'Body SM' ? 'color:var(--graphite);' : '') +
          (t.name === 'Caption' || t.name === 'Overline' ? 'color:var(--slate);' : '');

        return (
          '<div class="type-row">' +
            '<span class="type-row-label">' + t.name + '</span>' +
            '<span class="type-row-sample" style="' + inlineStyle + '">' + t.sample + '</span>' +
            '<span class="type-row-spec">' + specParts.join(' \u00B7 ') + '</span>' +
          '</div>'
        );
      }).join('');
    }

    /* ==============================================================
       7. Render voice
       ============================================================== */
    function renderVoice() {
      var voiceGrid = document.getElementById('voice-grid');
      if (!voiceGrid || !cfg.voice) return;

      voiceGrid.innerHTML =
        '<div class="voice-card do">' +
          '<div class="voice-card-label">' + esc(cfg.brand.displayName) + ' says</div>' +
          cfg.voice.do.filter(function (v) { return !isUnset(v); }).map(function (v) {
            return '<div class="voice-example">' + v + '</div>';
          }).join('') +
        '</div>' +
        '<div class="voice-card dont">' +
          '<div class="voice-card-label">' + esc(cfg.brand.displayName) + ' never says</div>' +
          cfg.voice.dont.filter(function (v) { return !isUnset(v); }).map(function (v) {
            return '<div class="voice-example">' + v + '</div>';
          }).join('') +
        '</div>';
    }

    /* ==============================================================
       8. Render components
       ============================================================== */
    function renderComponents() {
      var container = document.getElementById('components-content');
      if (!container) return;
      if (!cfg.components) {
        container.innerHTML = '<div class="empty-state">No component patterns configured</div>';
        return;
      }

      var html = '';

      // Buttons
      if (cfg.components.buttons) {
        cfg.components.buttons.forEach(function (group) {
          html += '<div class="component-label">' + group.variant + '</div>';
          group.items.forEach(function (item) {
            html += '<div class="component-row">';
            item.sizes.forEach(function (size, i) {
              html +=
                '<button class="btn ' + item.class + ' btn-' + size + '">' +
                item.labels[i] +
                '</button>';
            });
            html += '</div>';
          });
        });
      }

      // Cards
      if (cfg.components.cards) {
        html += '<div class="component-label" style="margin-top:28px;">Cards: Light Background</div>';
        html += '<div class="card-demo-grid">';
        cfg.components.cards.forEach(function (card) {
          var cardTitle = card.title || card.label || '';
          var cardDesc = orBlank(card.description);
          var cardTag = card.tag || '';
          html +=
            '<div class="card-demo">' +
              '<h4>' + cardTitle + '</h4>' +
              '<p>' + cardDesc + '</p>' +
              (cardTag ? '<span class="tag">' + cardTag + '</span>' : '') +
            '</div>';
        });
        html += '</div>';
      }

      // Stats
      if (cfg.components.stats) {
        html += '<div class="component-label" style="margin-top:28px;">Stats: Dark Background</div>';
        html += '<div class="dark-card-demo">';
        html += '<div class="dark-section-label">By the numbers</div>';
        html += '<div class="dark-card-demo-grid">';
        cfg.components.stats.forEach(function (stat) {
          html +=
            '<div class="dark-card">' +
              '<h4>' + stat.value + '</h4>' +
              '<p>' + stat.label + '</p>' +
            '</div>';
        });
        html += '</div></div>';
      }

      container.innerHTML = html;
    }

    /* ==============================================================
       9. Render spacing
       ============================================================== */
    function renderSpacing() {
      var scale = document.getElementById('spacing-scale');
      if (!scale) return;
      var data = cfg.spacing || [
        { px: 4, token: 'space-1' }, { px: 8, token: 'space-2' }, { px: 12, token: 'space-3' },
        { px: 16, token: 'space-4' }, { px: 24, token: 'space-6' }, { px: 32, token: 'space-8' },
        { px: 48, token: 'space-12' }, { px: 64, token: 'space-16' }, { px: 96, token: 'space-24' }
      ];
      scale.innerHTML = data.map(function (s) {
        return (
          '<div class="spacing-row">' +
            '<span class="spacing-label">' + s.px + 'px</span>' +
            '<div class="spacing-bar" style="width:' + Math.min(s.px * 4, 400) + 'px;">' +
              '<span class="spacing-value">' + s.token + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    /* ==============================================================
       10. Render accessibility
       ============================================================== */
    function renderAccessibility() {
      var grid = document.getElementById('a11y-grid');
      if (!grid) return;
      if (!cfg.accessibility || !cfg.accessibility.length) {
        grid.innerHTML = '<div class="empty-state">No accessibility pairs configured</div>';
        return;
      }

      grid.innerHTML = cfg.accessibility.filter(function (a) {
          // Suppress surface-on-surface pairs, but never a FAILURE: the
          // generator keeps `textPairing || !passes` precisely so a problem
          // can be reported, and filtering on textPairing alone hid every
          // recorded failure from the page while brand.md still listed it.
          return a.textPairing !== false || a.passes === false;
        }).map(function (a) {
        // Field aliases
        var bg = a.bg || a.background || '#FFFFFF';
        var fg = a.fg || a.foreground || '#000000';
        var bgName = a.bgName || '';
        var fgName = a.fgName || '';
        var rating = a.rating || a.level || '';
        var ratio = a.ratio || '';
        // Split "pair" field if bgName/fgName missing
        if (!bgName && !fgName && a.pair) {
          var parts = a.pair.split(' on ');
          if (parts.length === 2) { fgName = parts[0]; bgName = parts[1]; }
        }

        var ratingClass =
          (rating === 'AAA' || rating === 'AA') ? 'pass' :
          rating === 'AA Large' ? 'large' : 'fail';
        var border = a.border ? 'border:1px solid var(--mist);' : '';
        var textSize = a.largeText ? 'font-size:20px;font-weight:600;' : '';

        return (
          '<div class="a11y-card" style="background:' + bg + ';color:' + fg + ';' + border + '">' +
            '<div class="a11y-text" style="' + textSize + '">' + fgName + ' on ' + bgName + '</div>' +
            '<div class="a11y-meta">' +
              '<span class="a11y-ratio">' + ratio + '</span>' +
              '<span class="a11y-badge ' + ratingClass + '">' + rating + '</span>' +
            '</div>' +
          '</div>'
        );
      }).join('');
    }

    /* ==============================================================
       11. Render CSS variables
       ============================================================== */
    function renderCSSVars() {
      var codeBlock = document.getElementById('code-block');
      if (!codeBlock) return;
      if (!cfg.cssVariables || !cfg.cssVariables.length) {
        codeBlock.innerHTML = '<span class="code-section">/* No CSS variables configured */</span>';
        return;
      }

      codeBlock.innerHTML = cfg.cssVariables.map(function (section) {
        var sectionName = section.section || section.name || 'Variables';
        var vars = section.vars || [];
        var sectionComment = '<span class="code-section">/* \u2500\u2500 ' + sectionName + ' \u2500\u2500 */</span>';
        var lines = vars.map(function (v) {
          // Field aliases
          var prop = v.prop || v.var || v.name || '';
          var value = v.value || '';
          var comment = v.comment || v.usage || '';
          var copyVal = prop + ': ' + value + ';';
          var commentHtml = comment ? '    <span class="token-comment">/* ' + comment + ' */</span>' : '';
          return (
            '<span class="code-line" data-copy="' + copyVal.replace(/"/g, '&quot;') + '">' +
              '<span class="token-prop">' + prop + '</span>: ' +
              '<span class="token-value">' + value + '</span>;' +
              commentHtml +
            '</span>'
          );
        }).join('\n');
        return sectionComment + '\n' + lines;
      }).join('\n\n');
    }

    /* ==============================================================
       12. Render hierarchy (from config)
       ============================================================== */
    function renderHierarchy() {
      var container = document.getElementById('hierarchy-content');
      if (!container) return;
      if (!cfg.hierarchy || !cfg.hierarchy.length) {
        container.innerHTML = '<div class="empty-state">No text hierarchy configured</div>';
        return;
      }

      var demoHtml = '<div class="hierarchy-demo">';
      cfg.hierarchy.forEach(function (h) {
        demoHtml += '<p class="' + esc(h.class) + '">' + esc(h.description) + '</p>';
      });
      demoHtml += '</div>';

      var labelsHtml = '<div class="hierarchy-labels">';
      cfg.hierarchy.forEach(function (h) {
        labelsHtml +=
          '<div class="hierarchy-label">' +
            '<div class="hierarchy-dot" style="background: var(' + cssVarName(h.colorVar) + ');"></div> ' +
            esc(h.colorName) + ': <span class="hierarchy-hex">' + esc(h.hex) + '</span>' +
          '</div>';
      });
      labelsHtml += '</div>';

      container.innerHTML = demoHtml + labelsHtml;
    }

    /* ==============================================================
       13. Render section intros (from config)
       ============================================================== */
    function renderSectionIntros() {
      if (!cfg.sections) return;
      var mapping = {
        'gradients': 'section-intro-gradients',
        'logos': 'section-intro-logos',
        'logoUsage': 'section-intro-logoUsage',
        'formats': 'section-intro-formats',
        'components': 'section-intro-components',
        'spacing': 'section-intro-spacing',
        'variables': 'section-intro-variables'
      };
      var keys = Object.keys(mapping);
      for (var i = 0; i < keys.length; i++) {
        var el = document.getElementById(mapping[keys[i]]);
        if (el && cfg.sections[keys[i]]) {
          el.textContent = cfg.sections[keys[i]];
        }
      }
      // Gradient text demo
      var gradTextEl = document.getElementById('gradient-text-demo');
      if (gradTextEl && cfg.sections.gradientTextDemo) {
        gradTextEl.textContent = cfg.sections.gradientTextDemo;
      }
    }

    /* ==============================================================
       14. Copy to clipboard (initCopy)
       ============================================================== */
    function initCopy() {
      document.addEventListener('click', function (e) {
        // Color swatch
        var swatch = e.target.closest('.color-swatch.copyable');
        if (swatch) {
          var value = swatch.dataset[copyFormat] || swatch.dataset.hex;
          copyText(value);
          return;
        }

        // Color value text
        var colorVal = e.target.closest('.color-value.copyable');
        if (colorVal) {
          copyText(colorVal.dataset.copy || colorVal.textContent.trim());
          return;
        }

        // Gradient display
        var gradientCopy = e.target.closest('.gradient-display.copyable');
        if (gradientCopy) {
          copyText(gradientCopy.dataset.copy);
          return;
        }

        // Code lines
        var codeLine = e.target.closest('.code-line');
        if (codeLine) {
          copyText(codeLine.dataset.copy);
          return;
        }

        // Agent callout prompt
        var agentBtn = e.target.closest('#agent-callout-btn');
        if (agentBtn) {
          copyText(agentBtn.dataset.copy);
          return;
        }
      });
    }

    /* ==============================================================
       15. Copy format bar
       ============================================================== */
    function initFormatBar() {
      var bar = document.querySelector('.copy-format-bar');
      if (!bar) return;

      // Restore saved format
      bar.querySelectorAll('button').forEach(function (b) {
        b.classList.toggle('active', b.dataset.format === copyFormat);
      });

      bar.addEventListener('click', function (e) {
        var btn = e.target.closest('button');
        if (!btn) return;
        copyFormat = btn.dataset.format;
        localStorage.setItem('brandkit-copy-format', copyFormat);
        bar.querySelectorAll('button').forEach(function (b) {
          b.classList.toggle('active', b === btn);
        });
      });
    }

    /* ==============================================================
       16. Section navigation (IntersectionObserver)
       ============================================================== */
    function initNav() {
      var sections = document.querySelectorAll('.section[id]');
      var navLinks = document.querySelectorAll('#nav a');

      if (!sections.length || !navLinks.length) return;

      var observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            navLinks.forEach(function (link) {
              link.classList.toggle('active', link.getAttribute('href') === '#' + entry.target.id);
            });
          }
        });
      }, { rootMargin: '-20% 0px -70% 0px' });

      sections.forEach(function (section) { observer.observe(section); });

      navLinks.forEach(function (link) {
        link.addEventListener('click', function (e) {
          e.preventDefault();
          var target = document.querySelector(link.getAttribute('href'));
          if (target) target.scrollIntoView({ behavior: 'smooth' });
        });
      });
    }

    /* ==============================================================
       17. Type tester
       ============================================================== */
    function initTypeTester() {
      var testerFont = document.getElementById('type-tester-font');
      var testerInput = document.getElementById('type-tester-input');
      if (!testerFont || !testerInput) return;

      testerFont.addEventListener('change', function () {
        // The option value is already a complete font stack (incl. fallback).
        testerInput.style.fontFamily = testerFont.value;
      });
    }

    /* ==============================================================
       18. Render shell (header, intro, footer, misc)
       ============================================================== */
    function renderShell() {
      // Header: show brand.headerLogo image if set, else the brand name as text.
      // brand.guideLabel renames the "Web Style Guide" label (header + footer).
      var guideLabel = cfg.brand.guideLabel || 'Web Style Guide';
      var wordmark = document.getElementById('header-wordmark');
      if (wordmark) {
        if (cfg.brand.headerLogo) {
          wordmark.innerHTML = '<img class="header-logo" src="' + esc(assetUrl(cfg.brand.headerLogo)) +
            '" alt="' + esc(cfg.brand.name || 'Logo') + '">';
        } else {
          wordmark.textContent = cfg.brand.name;
        }
      }
      var meta = document.getElementById('header-meta');
      if (meta) meta.innerHTML = esc(guideLabel) + ' v' + esc(cfg.brand.version) + '<br>' + esc(cfg.brand.date);

      // Intro
      var intro = document.getElementById('intro');
      setOrPlaceholder(intro, cfg.brand.description, 'Description not yet defined.');

      // Voice intro
      var voiceIntro = document.getElementById('voice-intro');
      if (cfg.voice) setOrPlaceholder(voiceIntro, cfg.voice.description, 'Voice and tone not yet defined.');

      // Footer
      var footer = document.getElementById('footer');
      if (footer) footer.innerHTML =
        '<span>' + esc(cfg.brand.url) + ' \u00B7 ' + esc(cfg.brand.byline) + '</span>' +
        '<span>' + esc(guideLabel) + ' v' + esc(cfg.brand.version) + ' \u00B7 ' + esc(cfg.brand.date) + '</span>';

      // Typography specimens: read descriptions from config
      var typeDisplayName = document.getElementById('type-display-name');
      if (typeDisplayName && cfg.fonts) typeDisplayName.textContent = cfg.fonts.display.family;
      var typeDisplayDesc = document.getElementById('type-display-desc');
      if (typeDisplayDesc && cfg.fonts && !isUnset(cfg.fonts.display.description)) {
        typeDisplayDesc.textContent = cfg.fonts.display.description;
      }

      var typeBodyName = document.getElementById('type-body-name');
      if (typeBodyName && cfg.fonts) typeBodyName.textContent = cfg.fonts.body.family;
      var typeBodyDesc = document.getElementById('type-body-desc');
      if (typeBodyDesc && cfg.fonts && !isUnset(cfg.fonts.body.description)) {
        typeBodyDesc.textContent = cfg.fonts.body.description;
      }

      // Type tester font options
      var testerFont = document.getElementById('type-tester-font');
      var testerInput = document.getElementById('type-tester-input');
      if (testerFont && cfg.fonts) {
        // De-duplicate by family so a brand using one typeface for both
        // display and body shows a single option, not the same one twice.
        // The option value carries the full font stack (incl. any fallback)
        // so the tester renders in the web stand-in when one is configured;
        // the label stays the clean family name.
        var fontList = [];
        if (cfg.fonts.display && cfg.fonts.display.family) fontList.push(cfg.fonts.display);
        if (cfg.fonts.body && cfg.fonts.body.family) fontList.push(cfg.fonts.body);
        // null-proto map so a family literally named "__proto__"/"toString"
        // isn't mistaken for already-seen via an inherited Object property.
        var seenFam = Object.create(null);
        var uniqueFonts = [];
        fontList.forEach(function (f) {
          if (!seenFam[f.family]) { seenFam[f.family] = true; uniqueFonts.push(f); }
        });
        testerFont.innerHTML = uniqueFonts.map(function (f) {
          return '<option value="' + esc(fontStack(f)) + '">' + esc(f.family) + '</option>';
        }).join('');
        if (testerInput && uniqueFonts.length) {
          testerInput.style.fontFamily = fontStack(uniqueFonts[0]);
        }
      }

      // Gradient data-copy attributes, inline styles, and labels
      var gradBrand = document.getElementById('gradient-brand-copy');
      if (gradBrand && cfg.gradients && cfg.gradients[0]) {
        gradBrand.dataset.copy = cfg.gradients[0].css;
        gradBrand.style.background = cfg.gradients[0].css;
      }
      var gradBrandLabel = document.getElementById('gradient-brand-label');
      if (gradBrandLabel && cfg.gradients && cfg.gradients[0]) {
        var g0desc = cfg.gradients[0].description || cfg.gradients[0].usage || '';
        gradBrandLabel.textContent = cfg.gradients[0].name + ' Gradient \u00B7 135\u00B0 \u00B7 ' + g0desc;
      }

      var gradSubtle = document.getElementById('gradient-subtle-copy');
      if (gradSubtle && cfg.gradients && cfg.gradients[1]) {
        gradSubtle.dataset.copy = cfg.gradients[1].css;
        gradSubtle.style.background = cfg.gradients[1].css;
      }
      var gradSubtleLabel = document.getElementById('gradient-subtle-label');
      if (gradSubtleLabel && cfg.gradients && cfg.gradients[1]) {
        var g1desc = cfg.gradients[1].description || cfg.gradients[1].usage || '';
        gradSubtleLabel.textContent = cfg.gradients[1].name + ' Gradient \u00B7 135\u00B0 \u00B7 ' + g1desc;
      }

      // Gradient usage do/don't
      var gradUsage = document.getElementById('gradient-usage');
      if (gradUsage && cfg.gradientUsage) {
        gradUsage.innerHTML =
          '<div class="gradient-usage-card do">' +
            '<h4>Use gradient for</h4>' +
            '<ul>' + cfg.gradientUsage.do.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>' +
          '</div>' +
          '<div class="gradient-usage-card dont">' +
            "<h4>Don't use gradient for</h4>" +
            '<ul>' + cfg.gradientUsage.dont.map(function (item) { return '<li>' + item + '</li>'; }).join('') + '</ul>' +
          '</div>';
      }

      // Sidebar brand: logo image if brand.sidebarLogo is set, else brand name
      var sidebarBrand = document.querySelector('.sidebar-brand');
      if (sidebarBrand) {
        if (cfg.brand.sidebarLogo) {
          sidebarBrand.innerHTML = '<img class="sidebar-logo" src="' + esc(assetUrl(cfg.brand.sidebarLogo)) +
            '" alt="' + esc(cfg.brand.name || 'Logo') + '">';
        } else {
          sidebarBrand.textContent = cfg.brand.name || 'Brand';
        }
      }
    }

    /* ==============================================================
       Execute all
       ============================================================== */
    bootstrap();
    renderShell();
    renderNav();
    renderAgentCallout();
    renderChangelogLink();
    renderSectionIntros();
    renderColors();
    renderGradients();
    renderLogos();
    renderLogoUsage();
    renderFormats();
    renderTypography();
    renderHierarchy();
    renderVoice();
    renderComponents();
    renderSpacing();
    renderAccessibility();
    renderCSSVars();

    initCopy();
    initFormatBar();
    initNav();
    initTypeTester();
  }
})();
