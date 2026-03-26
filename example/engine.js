/**
 * Brandkit Rendering Engine
 * Loads config.json → bootstraps theme → renders all sections → wires interactivity
 */
(async function () {
  /* ================================================================
     0. Load config
     ================================================================ */
  var res = await fetch('./config.json');
  var config = await res.json();
  init(config);

  function init(cfg) {
    var copyFormat = localStorage.getItem('brandkit-copy-format') || 'hex';

    /* ==============================================================
       BOOTSTRAP — inject fonts + CSS variables before any rendering
       ============================================================== */
    function bootstrap() {
      // Inject Google Fonts
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

      // Inject CSS custom properties from theme
      if (cfg.theme) {
        var vars = [];
        var keys = Object.keys(cfg.theme);
        for (var i = 0; i < keys.length; i++) {
          vars.push('  ' + keys[i] + ': ' + cfg.theme[keys[i]] + ';');
        }
        // Add font variables from config
        if (cfg.fonts) {
          if (cfg.fonts.display) vars.push("  --font-display: '" + cfg.fonts.display.family + "', sans-serif;");
          if (cfg.fonts.body) vars.push("  --font-body: '" + cfg.fonts.body.family + "', sans-serif;");
        }
        var style = document.createElement('style');
        style.setAttribute('data-brandkit-theme', '');
        style.textContent = ':root {\n' + vars.join('\n') + '\n}';
        document.head.appendChild(style);
      }

      // Set page title
      if (cfg.brand && cfg.brand.displayName) {
        document.title = cfg.brand.displayName + ' \u2014 Brand Guide';
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
        toast('Copy failed \u2014 try from localhost or HTTPS');
      }
    }

    /* ==============================================================
       2. Render navigation
       ============================================================== */
    function renderNav() {
      var navEl = document.getElementById('nav');
      if (!navEl || !cfg.nav) return;
      navEl.innerHTML = cfg.nav.map(function (group) {
        var header = '<li class="nav-group">' + group.group + '</li>';
        var items = group.items.map(function (item) {
          return '<li class="nav-group-items"><a href="#' + item.id + '">' + item.label + '</a></li>';
        }).join('');
        return header + items;
      }).join('');
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
        var valueDisplay = oklch ? (hex + ' \u00B7 ' + oklch) : hex;
        return (
          '<div class="color-card">' +
            '<div class="color-swatch copyable ' + (isLight ? 'has-border' : '') + '"' +
              ' style="background:' + hex + ';"' +
              ' data-hex="' + hex + '"' +
              ' data-oklch="' + oklch + '"' +
              ' data-css-var="' + cssVar + '"' +
              ' tabindex="0" role="button" aria-label="Copy ' + name + ' color value">' +
              '<div class="copy-hint"><span>Click to copy</span></div>' +
            '</div>' +
            '<div class="color-name">' + name + '</div>' +
            '<div class="color-value copyable" data-copy="' + hex + '">' + valueDisplay + '</div>' +
            '<div class="color-role">' + role + '</div>' +
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
      var stopsContainer = document.getElementById('gradient-stops');
      if (!stopsContainer || !cfg.gradients || !cfg.gradients.length) return;
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
            '<img src="' + previewSrc + '" alt="' + logo.name + '">' +
            '<div class="logo-name">' + logo.name + '</div>' +
            '<div class="logo-description">' + (logo.description || '') + '</div>' +
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
          '<div class="voice-card-label">' + cfg.brand.displayName + ' says</div>' +
          cfg.voice.do.map(function (v) {
            return '<div class="voice-example">' + v + '</div>';
          }).join('') +
        '</div>' +
        '<div class="voice-card dont">' +
          '<div class="voice-card-label">' + cfg.brand.displayName + ' never says</div>' +
          cfg.voice.dont.map(function (v) {
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
        html += '<div class="component-label" style="margin-top:28px;">Cards \u2014 Light Background</div>';
        html += '<div class="card-demo-grid">';
        cfg.components.cards.forEach(function (card) {
          var cardTitle = card.title || card.label || '';
          var cardDesc = card.description || '';
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
        html += '<div class="component-label" style="margin-top:28px;">Stats \u2014 Dark Background</div>';
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

      grid.innerHTML = cfg.accessibility.map(function (a) {
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
        demoHtml += '<p class="' + h.class + '">' + h.description + '</p>';
      });
      demoHtml += '</div>';

      var labelsHtml = '<div class="hierarchy-labels">';
      cfg.hierarchy.forEach(function (h) {
        labelsHtml +=
          '<div class="hierarchy-label">' +
            '<div class="hierarchy-dot" style="background: var(' + h.colorVar + ');"></div> ' +
            h.colorName + ': ' + h.hex +
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
        testerInput.style.fontFamily = "'" + testerFont.value + "', sans-serif";
      });
    }

    /* ==============================================================
       18. Render shell (header, intro, footer, misc)
       ============================================================== */
    function renderShell() {
      // Header
      var wordmark = document.getElementById('header-wordmark');
      if (wordmark) wordmark.textContent = cfg.brand.name;
      var meta = document.getElementById('header-meta');
      if (meta) meta.innerHTML = 'Web Style Guide v' + cfg.brand.version + '<br>' + cfg.brand.date;

      // Intro
      var intro = document.getElementById('intro');
      if (intro) intro.textContent = cfg.brand.description;

      // Voice intro
      var voiceIntro = document.getElementById('voice-intro');
      if (voiceIntro && cfg.voice) voiceIntro.textContent = cfg.voice.description;

      // Footer
      var footer = document.getElementById('footer');
      if (footer) footer.innerHTML =
        '<span>' + cfg.brand.url + ' \u00B7 ' + cfg.brand.byline + '</span>' +
        '<span>Web Style Guide v' + cfg.brand.version + ' \u00B7 ' + cfg.brand.date + '</span>';

      // Typography specimens — read descriptions from config
      var typeDisplayName = document.getElementById('type-display-name');
      if (typeDisplayName && cfg.fonts) typeDisplayName.textContent = cfg.fonts.display.family;
      var typeDisplayDesc = document.getElementById('type-display-desc');
      if (typeDisplayDesc && cfg.fonts && cfg.fonts.display.description) {
        typeDisplayDesc.textContent = cfg.fonts.display.description;
      }

      var typeBodyName = document.getElementById('type-body-name');
      if (typeBodyName && cfg.fonts) typeBodyName.textContent = cfg.fonts.body.family;
      var typeBodyDesc = document.getElementById('type-body-desc');
      if (typeBodyDesc && cfg.fonts && cfg.fonts.body.description) {
        typeBodyDesc.textContent = cfg.fonts.body.description;
      }

      // Type tester font options
      var testerFont = document.getElementById('type-tester-font');
      var testerInput = document.getElementById('type-tester-input');
      if (testerFont && cfg.fonts) {
        testerFont.innerHTML =
          '<option value="' + cfg.fonts.display.family + '">' + cfg.fonts.display.family + '</option>' +
          '<option value="' + cfg.fonts.body.family + '">' + cfg.fonts.body.family + '</option>';
        if (testerInput) {
          testerInput.style.fontFamily = "'" + cfg.fonts.display.family + "', sans-serif";
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

      // Sidebar brand name
      var sidebarBrand = document.querySelector('.sidebar-brand');
      if (sidebarBrand) sidebarBrand.textContent = 'brandkit';
    }

    /* ==============================================================
       Execute all
       ============================================================== */
    bootstrap();
    renderShell();
    renderNav();
    renderSectionIntros();
    renderColors();
    renderGradients();
    renderLogos();
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
