/**
 * Color conversion and contrast computation helpers for brandkit generate.
 * Pure math — no dependencies.
 */

/**
 * Parse hex color to {r, g, b} (0–255).
 */
function hexToRgb(hex) {
  hex = hex.replace(/^#/, '');
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Convert hex to "r, g, b" string for CSS rgba(var(--x-rgb), alpha) usage.
 */
function hexToRgbString(hex) {
  var c = hexToRgb(hex);
  return c.r + ', ' + c.g + ', ' + c.b;
}

/**
 * sRGB channel (0–255) → linear light (0–1).
 */
function srgbToLinear(c) {
  c = c / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/**
 * Linear light (0–1) → sRGB (0–255).
 */
function linearToSrgb(c) {
  c = Math.max(0, Math.min(1, c));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/**
 * Convert hex to approximate oklch string.
 * hex → sRGB → linear RGB → OKLab → OKLCH
 */
function hexToOklch(hex) {
  var rgb = hexToRgb(hex);
  var lr = srgbToLinear(rgb.r);
  var lg = srgbToLinear(rgb.g);
  var lb = srgbToLinear(rgb.b);

  // Linear RGB → LMS (using OKLab matrix)
  var l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  var m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  var s_ = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;

  // Cube root
  var l = Math.cbrt(l_);
  var m = Math.cbrt(m_);
  var s = Math.cbrt(s_);

  // LMS → OKLab
  var L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  var a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  var b = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;

  // OKLab → OKLCH
  var C = Math.sqrt(a * a + b * b);
  var H = Math.atan2(b, a) * 180 / Math.PI;
  if (H < 0) H += 360;

  return 'oklch(' + L.toFixed(2) + ' ' + C.toFixed(2) + ' ' + Math.round(H) + ')';
}

/**
 * Check if a hex color is "light" (for border display on swatches).
 */
function isLightColor(hex) {
  return relativeLuminance(hex) > 0.35;
}

/**
 * Compute relative luminance of a hex color (WCAG 2.1).
 */
function relativeLuminance(hex) {
  var rgb = hexToRgb(hex);
  var lr = srgbToLinear(rgb.r);
  var lg = srgbToLinear(rgb.g);
  var lb = srgbToLinear(rgb.b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Compute WCAG contrast ratio between two hex colors.
 * Returns a string like "7.2:1".
 */
function contrastRatio(hex1, hex2) {
  var l1 = relativeLuminance(hex1);
  var l2 = relativeLuminance(hex2);
  var lighter = Math.max(l1, l2);
  var darker = Math.min(l1, l2);
  var ratio = (lighter + 0.05) / (darker + 0.05);
  return ratio.toFixed(1) + ':1';
}

/**
 * Rate a contrast ratio string per WCAG.
 * Returns 'AAA', 'AA', 'AA Large', or 'Fail'.
 */
function rateContrast(ratioStr) {
  var ratio = parseFloat(ratioStr);
  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA Large';
  return 'Fail';
}

/**
 * Generate accessibility pairs from a set of colors.
 * Tests key color combinations against white, black, and each other.
 */
function generateA11yPairs(colors) {
  var pairs = [];
  var white = '#FFFFFF';
  var testColors = [];
  var seenHexes = {};

  // Collect unique colors
  for (var i = 0; i < colors.length; i++) {
    var c = colors[i];
    if (c.hex && !seenHexes[c.hex]) {
      seenHexes[c.hex] = true;
      testColors.push({ hex: c.hex, name: c.name || c.hex });
    }
  }

  // Test each color against white
  for (var j = 0; j < testColors.length; j++) {
    var tc = testColors[j];
    if (tc.hex === white) continue;
    var ratio = contrastRatio(tc.hex, white);
    var rating = rateContrast(ratio);
    if (rating !== 'Fail') {
      pairs.push({
        fg: tc.hex,
        bg: white,
        fgName: tc.name,
        bgName: 'White',
        ratio: ratio,
        rating: rating,
        border: true,
        largeText: rating === 'AA Large'
      });
    }
    // Reverse: white on color
    var revRatio = contrastRatio(white, tc.hex);
    var revRating = rateContrast(revRatio);
    if (revRating !== 'Fail' && !isLightColor(tc.hex)) {
      pairs.push({
        fg: white,
        bg: tc.hex,
        fgName: 'White',
        bgName: tc.name,
        ratio: revRatio,
        rating: revRating,
        border: false,
        largeText: false
      });
    }
  }

  return pairs;
}

/**
 * Build cssVariables sections from a theme object.
 */
function buildCssVariablesFromTheme(theme) {
  if (!theme) return [];
  var colorVars = [];
  var gradientVars = [];
  var typographyVars = [];
  var otherVars = [];

  var keys = Object.keys(theme);
  for (var i = 0; i < keys.length; i++) {
    var prop = keys[i];
    var value = theme[prop];
    var entry = { prop: prop, value: value, comment: '' };

    if (prop.indexOf('gradient') !== -1) {
      gradientVars.push(entry);
    } else if (prop.indexOf('font') !== -1) {
      typographyVars.push(entry);
    } else if (prop.indexOf('rgb') !== -1) {
      // skip rgb variants — they're implementation details
      continue;
    } else {
      colorVars.push(entry);
    }
  }

  var sections = [];
  if (colorVars.length) sections.push({ section: 'Colors', vars: colorVars });
  if (gradientVars.length) sections.push({ section: 'Gradients', vars: gradientVars });
  if (typographyVars.length) sections.push({ section: 'Typography', vars: typographyVars });
  if (otherVars.length) sections.push({ section: 'Other', vars: otherVars });

  return sections;
}

/**
 * Build hierarchy entries from theme colors.
 */
function buildHierarchyFromTheme(theme) {
  if (!theme) return [];
  // Resolve each level: try preferred key, then fallback, track which key was actually used
  function resolve(preferred, fallbacks, defaultVal) {
    if (theme[preferred]) return { key: preferred, value: theme[preferred] };
    for (var i = 0; i < fallbacks.length; i++) {
      if (theme[fallbacks[i]]) return { key: fallbacks[i], value: theme[fallbacks[i]] };
    }
    return { key: preferred, value: defaultVal };
  }

  var fg = resolve('--ink', ['--foreground'], '#111827');
  var secondary = resolve('--graphite', ['--slate', '--muted-foreground'], '#374151');
  var tertiary = resolve('--slate', ['--haze', '--muted-foreground'], '#6B7280');
  var accent = resolve('--purple', ['--coral', '--primary'], '#6366F1');

  function keyToName(key) {
    return key.replace(/^--/, '').replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  return [
    { class: 'h-primary', label: 'Primary', colorVar: fg.key, colorName: keyToName(fg.key), hex: fg.value, description: 'Primary text — body copy, headings, and content where readability is critical.' },
    { class: 'h-secondary', label: 'Secondary', colorVar: secondary.key, colorName: keyToName(secondary.key), hex: secondary.value, description: 'Secondary text — descriptions, supporting information, and labels.' },
    { class: 'h-tertiary', label: 'Tertiary', colorVar: tertiary.key, colorName: keyToName(tertiary.key), hex: tertiary.value, description: 'Tertiary text — captions, timestamps, footnotes, and metadata.' },
    { class: 'h-accent', label: 'Accent', colorVar: accent.key, colorName: keyToName(accent.key), hex: accent.value, description: 'Accent text — links, interactive labels, and calls to action.' }
  ];
}

/**
 * Parse a CSS gradient string into stops array.
 * E.g. "linear-gradient(135deg, #4A1D75 0%, #6B2FA0 30%)" → [{color, position, name}]
 */
function parseGradientStops(css) {
  if (!css) return [];
  var stops = [];
  var regex = /(#[0-9a-fA-F]{3,8})\s+(\d+%)/g;
  var match;
  while ((match = regex.exec(css)) !== null) {
    stops.push({ color: match[1], position: match[2], name: match[1] });
  }
  return stops;
}

/**
 * Build gradient entries from theme.
 */
function buildGradientsFromTheme(theme) {
  if (!theme) return [];
  var gradients = [];

  var brand = theme['--gradient-brand'];
  if (brand) {
    gradients.push({
      name: 'Brand',
      css: brand,
      description: 'Primary gradient — hero backgrounds, feature sections',
      stops: parseGradientStops(brand)
    });
  }

  var subtle = theme['--gradient-brand-subtle'];
  if (subtle) {
    gradients.push({
      name: 'Subtle',
      css: subtle,
      description: 'Subtle tint — card backgrounds, hover states'
    });
  }

  return gradients;
}

/**
 * Scaffold a default type scale.
 */
function scaffoldTypography() {
  return [
    { name: 'Display XL', font: 'display', size: '72px', weight: 700, tracking: '-0.03em', leading: '1.05', sample: '__TODO: Hero headline' },
    { name: 'Display', font: 'display', size: '56px', weight: 700, tracking: '-0.025em', leading: '1.1', sample: '__TODO: Section headline' },
    { name: 'H1', font: 'display', size: '44px', weight: 700, tracking: '-0.02em', leading: '1.15', sample: '__TODO: Page heading' },
    { name: 'H2', font: 'display', size: '36px', weight: 700, tracking: '-0.015em', leading: '1.2', sample: '__TODO: Section heading' },
    { name: 'H3', font: 'display', size: '28px', weight: 600, tracking: '-0.01em', leading: '1.3', sample: '__TODO: Subsection heading' },
    { name: 'H4', font: 'display', size: '22px', weight: 600, tracking: '-0.005em', leading: '1.35', sample: '__TODO: Card heading' },
    { name: 'Body LG', font: 'body', size: '18px', weight: 400, tracking: '0', leading: '1.7', sample: '__TODO: Intro paragraph text' },
    { name: 'Body', font: 'body', size: '16px', weight: 400, tracking: '0', leading: '1.7', sample: '__TODO: Body copy text' },
    { name: 'Body SM', font: 'body', size: '14px', weight: 400, tracking: '0', leading: '1.6', sample: '__TODO: Small body text' },
    { name: 'Caption', font: 'body', size: '12px', weight: 500, tracking: '0.02em', leading: '1.5', sample: '__TODO: Caption text' },
    { name: 'Overline', font: 'body', size: '11px', weight: 700, tracking: '0.1em', leading: '1.4', sample: '__TODO: Overline text', uppercase: true }
  ];
}

module.exports = {
  hexToRgb: hexToRgb,
  hexToRgbString: hexToRgbString,
  hexToOklch: hexToOklch,
  isLightColor: isLightColor,
  contrastRatio: contrastRatio,
  rateContrast: rateContrast,
  relativeLuminance: relativeLuminance,
  generateA11yPairs: generateA11yPairs,
  buildCssVariablesFromTheme: buildCssVariablesFromTheme,
  buildHierarchyFromTheme: buildHierarchyFromTheme,
  parseGradientStops: parseGradientStops,
  buildGradientsFromTheme: buildGradientsFromTheme,
  scaffoldTypography: scaffoldTypography
};
