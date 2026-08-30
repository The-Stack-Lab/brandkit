/**
 * Color conversion and contrast computation helpers for brandkit generate.
 * Pure math — no dependencies.
 */

/**
 * Parse hex color to {r, g, b} (0–255).
 */
function hexToRgb(hex) {
  hex = String(hex).replace(/^#/, '');
  // #RGB and #RGBA both expand from the first three nibbles; the alpha nibble
  // is dropped (the guide paints opaque swatches).
  if (hex.length === 3 || hex.length === 4) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
  }
  // #RRGGBBAA — truncate before parsing. parseInt() on all eight digits
  // exceeds 2^31, and `>>` then operates on a negative signed value, which
  // silently returned the GREEN channel as red (#AABBCCDD read as #BBCCDD).
  hex = hex.slice(0, 6);
  var n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * Convert hex to "r, g, b" string for CSS rgba(var(--x-rgb), alpha) usage.
 */
function hexToRgbString(hex) {
  var c = toRgb(hex);
  if (!c) return null;
  return clamp255(c.r) + ', ' + clamp255(c.g) + ', ' + clamp255(c.b);
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

/* ------------------------------------------------------------------ *
 * CSS color parsing
 *
 * brandkit is hex-native: swatches, WCAG contrast, the "r, g, b" tint
 * variants and the oklch display string all assume sRGB numbers. Tailwind 4
 * and shadcn emit oklch() by default, so every one of those silently failed
 * on a modern project. Rather than teach each consumer a new color space,
 * parse to sRGB once here and let callers keep the authored string alongside.
 * ------------------------------------------------------------------ */

var HEX_ONLY_RE = /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

// Only the keywords that realistically appear in a design token.
var NAMED_COLORS = {
  white: { r: 255, g: 255, b: 255 },
  black: { r: 0, g: 0, b: 0 }
};

function clamp255(n) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHex(rgb) {
  var s = '#';
  var parts = [rgb.r, rgb.g, rgb.b];
  for (var i = 0; i < parts.length; i++) {
    var h = clamp255(parts[i]).toString(16);
    s += h.length === 1 ? '0' + h : h;
  }
  return s.toUpperCase();
}

/** Pull the numeric arguments out of `fn(a b c / d)` or `fn(a, b, c, d)`. */
function colorArgs(value) {
  var open = value.indexOf('(');
  if (open === -1 || value.charAt(value.length - 1) !== ')') return null;
  var inner = value.slice(open + 1, -1).replace(/\//g, ' ');
  var parts = inner.split(/[\s,]+/).filter(function (p) { return p.length; });
  return parts.length ? parts : null;
}

/**
 * A component that may be written as a number or a percentage.
 * `scale` is what 100% means (1 for oklch lightness, 255 for rgb channels).
 */
function num(part, scale) {
  if (part === undefined || part === null) return NaN;
  var s = String(part).trim();
  if (s === 'none') return 0;
  if (s.charAt(s.length - 1) === '%') return parseFloat(s) / 100 * scale;
  return parseFloat(s);
}

/**
 * A CSS <angle> in degrees. `parseFloat` after stripping only "deg" accepted
 * turn/rad/grad at face value, so `hsl(0.5turn …)` — cyan — was read as 0.5deg
 * and rendered red. Returns NaN for anything that is not a bare angle.
 */
function angleDeg(part) {
  var s = String(part).trim().toLowerCase();
  if (s === 'none') return 0;
  var m = s.match(/^([+-]?(?:[0-9]*\.)?[0-9]+(?:e[+-]?[0-9]+)?)(deg|grad|rad|turn)?$/);
  if (!m) return NaN;
  var n = parseFloat(m[1]);
  switch (m[2] || 'deg') {
    case 'deg': return n;
    case 'grad': return n * 0.9;
    case 'rad': return n * 180 / Math.PI;
    case 'turn': return n * 360;
  }
  return NaN;
}

function oklabToRgb(L, a, b) {
  var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  var s_ = L - 0.0894841775 * a - 1.2914855480 * b;

  var l = l_ * l_ * l_;
  var m = m_ * m_ * m_;
  var s = s_ * s_ * s_;

  // Out-of-gamut colors are clamped per channel by linearToSrgb. Chroma
  // reduction would preserve hue better, but clamping never invents a value
  // and keeps this dependency-free.
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255,
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255,
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s) * 255
  };
}

/**
 * Parse any CSS color brandkit is likely to meet into sRGB.
 * Returns { r, g, b } or null — never a guess.
 */
function toRgb(value) {
  if (!value || typeof value !== 'string') return null;
  var v = value.trim();
  if (!v) return null;

  var lower = v.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, lower)) {
    var named = NAMED_COLORS[lower];
    return { r: named.r, g: named.g, b: named.b };
  }

  if (v.charAt(0) === '#') {
    if (!HEX_ONLY_RE.test(v)) return null;
    return hexToRgb(v);
  }

  var fn = lower.slice(0, lower.indexOf('(')).trim();
  var args = colorArgs(lower);
  if (!args) return null;

  if (fn === 'oklch') {
    var L = num(args[0], 1);
    var C = num(args[1], 0.4);
    var H = angleDeg(args[2]);
    if (isNaN(L) || isNaN(C) || isNaN(H)) return null;
    var rad = H * Math.PI / 180;
    return oklabToRgb(L, C * Math.cos(rad), C * Math.sin(rad));
  }

  if (fn === 'oklab') {
    var oL = num(args[0], 1);
    var oa = num(args[1], 0.4);
    var ob = num(args[2], 0.4);
    if (isNaN(oL) || isNaN(oa) || isNaN(ob)) return null;
    return oklabToRgb(oL, oa, ob);
  }

  if (fn === 'rgb' || fn === 'rgba') {
    var r = num(args[0], 255);
    var g = num(args[1], 255);
    var b2 = num(args[2], 255);
    if (isNaN(r) || isNaN(g) || isNaN(b2)) return null;
    return { r: r, g: g, b: b2 };
  }

  if (fn === 'hsl' || fn === 'hsla') {
    var hh = angleDeg(args[0]);
    var ss = num(args[1], 1);
    var ll = num(args[2], 1);
    if (isNaN(hh) || isNaN(ss) || isNaN(ll)) return null;
    return hslToRgbChannels(hh, ss, ll);
  }

  return null;
}

function hslToRgbChannels(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  var c = (1 - Math.abs(2 * l - 1)) * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = l - c / 2;
  var t;
  if (h < 60) t = [c, x, 0];
  else if (h < 120) t = [x, c, 0];
  else if (h < 180) t = [0, c, x];
  else if (h < 240) t = [0, x, c];
  else if (h < 300) t = [x, 0, c];
  else t = [c, 0, x];
  return { r: (t[0] + m) * 255, g: (t[1] + m) * 255, b: (t[2] + m) * 255 };
}

/**
 * Normalize any CSS color to hex while remembering how it was authored.
 * Returns null for gradients, "r, g, b" triples, unresolved var() and
 * anything else that is not a single color — those must never become tokens.
 */
function parseCssColor(value) {
  var rgb = toRgb(value);
  if (!rgb) return null;
  var v = String(value).trim();
  // A keyword has no function head, so splitting on '(' returned the keyword
  // itself — DTCG then advertised colorSpace "white" for `--cloud: white`.
  var space = v.charAt(0) === '#' ? 'hex'
    : (v.indexOf('(') === -1 ? 'named' : v.toLowerCase().split('(')[0].trim());
  return { hex: toHex(rgb), original: v, space: space };
}

/**
 * Convert hex to approximate oklch string.
 * hex → sRGB → linear RGB → OKLab → OKLCH
 */
function hexToOklch(hex) {
  var rgb = toRgb(hex);
  if (!rgb) return null;
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
function isLightColor(color) {
  var lum = relativeLuminance(color);
  return lum === null ? false : lum > 0.35;
}

/**
 * Compute relative luminance of any CSS color (WCAG 2.1).
 * Returns null when the value cannot be parsed.
 */
function relativeLuminance(color) {
  var rgb = toRgb(color);
  if (!rgb) return null;
  var lr = srgbToLinear(rgb.r);
  var lg = srgbToLinear(rgb.g);
  var lb = srgbToLinear(rgb.b);
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/**
 * Compute the WCAG contrast ratio between two CSS colors.
 * Returns a string like "7.2:1", or null if either color is unparseable.
 *
 * Returning null matters: hexToRgb() used to coerce any non-hex string to
 * {0,0,0}, so an oklch value silently scored 21.0:1 — a perfect-contrast
 * claim, AAA-rated, written into a client-facing accessibility table. An
 * unmeasurable pair must be reported as unmeasured, never as passing.
 */
function contrastRatio(color1, color2) {
  var l1 = relativeLuminance(color1);
  var l2 = relativeLuminance(color2);
  if (l1 === null || l2 === null) return null;
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
  // null in, null out: an unmeasurable pair is "unknown", not "Fail". Callers
  // drop it rather than publish a rating no one computed.
  if (ratioStr === null || ratioStr === undefined) return null;
  var ratio = parseFloat(ratioStr);
  if (isNaN(ratio)) return null;
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
    // `rating` is null when the pair could not be measured at all. Testing
    // only against 'Fail' let that through, publishing {ratio: null} into the
    // accessibility table — an unmeasured pair presented as a documented one.
    if (rating && rating !== 'Fail') {
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
    if (revRating && revRating !== 'Fail' && !isLightColor(tc.hex)) {
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
  var accent = resolve('--accent-text', ['--accent', '--purple', '--coral', '--primary'], '#6366F1');

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
  toRgb: toRgb,
  parseCssColor: parseCssColor,
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
