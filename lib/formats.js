/**
 * Output formats and logo usage: the rules for composing a canvas that is not
 * a web page (a social card, a slide, a video frame, a printed sheet).
 *
 * Colors and fonts say what a brand looks like. They do not say how big the
 * canvas is, where the logo sits, or how far text must stay from the edge, so
 * an agent handed only those produced on-palette work with off-brand layout.
 *
 * Pure functions, Node builtins only. The preset table is mirrored in
 * dist/engine.js (no module system there), keep the two in sync.
 */

// Dimensions a config can opt into by name without restating them. Only the
// canvas is preset. Logo position, backgrounds and type choices are brand
// decisions and stay in the consuming config.
var FORMAT_PRESETS = {
  'social-square':   { name: 'Social square (1:1)',           kind: 'social',       width: 1080, height: 1080, unit: 'px' },
  'social-portrait': { name: 'Social portrait (4:5)',         kind: 'social',       width: 1080, height: 1350, unit: 'px' },
  'social-story':    { name: 'Story or vertical video (9:16)', kind: 'social',       width: 1080, height: 1920, unit: 'px' },
  'link-card':       { name: 'Link preview card',             kind: 'social',       width: 1200, height: 630,  unit: 'px' },
  'slide-16x9':      { name: 'Slide 16:9',                    kind: 'presentation', width: 1920, height: 1080, unit: 'px' }
};

var PRESET_ALIASES = {
  '1080x1080': 'social-square',
  '1080x1350': 'social-portrait',
  '1080x1920': 'social-story',
  '1200x630': 'link-card',
  '1920x1080': 'slide-16x9'
};

var FORMAT_KINDS = ['social', 'presentation', 'video', 'print', 'other'];

// Mirrors isUnset() in lib/export.js. Kept local: export.js requires this file.
function isMarker(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  var t = v.trim();
  return t === '' || t.indexOf('__TODO') === 0;
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function lookupPreset(key) {
  if (typeof key !== 'string') return null;
  var k = key.trim().toLowerCase().replace(/\s+/g, '');
  if (PRESET_ALIASES[k]) k = PRESET_ALIASES[k];
  return Object.prototype.hasOwnProperty.call(FORMAT_PRESETS, k) ? { key: k, preset: FORMAT_PRESETS[k] } : null;
}

/**
 * One config entry (a preset name, or an object that may name a preset) to a
 * complete format. The entry's own fields always win over the preset's, so a
 * brand can rename "Social square (1:1)" to "Instagram square" and keep the
 * dimensions. An unknown preset is reported, never guessed at.
 */
function resolveFormat(entry) {
  if (typeof entry === 'string') entry = isMarker(entry) ? null : { preset: entry };
  if (!isObject(entry)) return null;
  var out = {};
  if (!isMarker(entry.preset)) {
    var found = lookupPreset(entry.preset);
    if (found) {
      out.preset = found.key;
      Object.keys(found.preset).forEach(function (k) { out[k] = found.preset[k]; });
    } else {
      out.unknownPreset = String(entry.preset);
    }
  }
  Object.keys(entry).forEach(function (k) {
    if (k === 'preset' || k === '__proto__') return;
    // An unfilled marker must not displace what the preset already supplied.
    if (isMarker(entry[k])) return;
    out[k] = entry[k];
  });
  if (typeof out.unit !== 'string') delete out.unit;
  if (out.unit === undefined && (out.width !== undefined || out.height !== undefined)) out.unit = 'px';
  if (out.kind !== undefined && FORMAT_KINDS.indexOf(out.kind) === -1) out.kind = 'other';
  return out;
}

/**
 * Is this resolved entry a format at all? It needs a canvas, a name, or at
 * least a preset someone tried to name. `{ "notes": "..." }` alone is not one.
 * dist/engine.js applies the same rule, so the page and the exports always
 * agree on how many formats a brand defines.
 */
function isFormat(f) {
  if (!f) return false;
  var hasDims = typeof f.width === 'number' && typeof f.height === 'number';
  return hasDims || (typeof f.name === 'string' && !isMarker(f.name)) || !!f.unknownPreset;
}

function resolveFormats(config) {
  var list = config && config.formats;
  if (!Array.isArray(list)) return [];
  return list.map(resolveFormat).filter(isFormat);
}

/**
 * safeZone: a number (same inset on every side) or { top, right, bottom, left }
 * (a missing side falls back to `all`, then 0). Always returns four sides, so a
 * consumer never has to know which shorthand the author used.
 */
function normalizeSafeZone(zone, unit) {
  if (zone === undefined || zone === null || zone === '') return null;
  var all = null, src = {};
  if (typeof zone === 'number') all = zone;
  else if (isObject(zone)) { src = zone; if (typeof zone.all === 'number') all = zone.all; }
  else return null;
  if (all !== null && all < 0) all = null; // a negative inset is not an inset
  var out = {};
  var any = all !== null;
  ['top', 'right', 'bottom', 'left'].forEach(function (side) {
    if (typeof src[side] === 'number' && src[side] >= 0) { out[side] = src[side]; any = true; }
    else out[side] = all !== null ? all : 0;
  });
  if (!any) return null;
  out.unit = (typeof src.unit === 'string' && !isMarker(src.unit)) ? src.unit
    : (typeof unit === 'string' && !isMarker(unit)) ? unit : 'px';
  return out;
}

/** clearSpace: a sentence, or { rule, ratio }. Returns { rule, ratio } or null. */
function normalizeClearSpace(v) {
  if (typeof v === 'string') return isMarker(v) ? null : { rule: v };
  if (!isObject(v)) return null;
  var out = {};
  if (typeof v.rule === 'string' && !isMarker(v.rule)) out.rule = v.rule;
  if (typeof v.ratio === 'number' && v.ratio > 0) out.ratio = v.ratio;
  return Object.keys(out).length ? out : null;
}

module.exports = {
  FORMAT_PRESETS: FORMAT_PRESETS,
  PRESET_ALIASES: PRESET_ALIASES,
  FORMAT_KINDS: FORMAT_KINDS,
  resolveFormat: resolveFormat,
  resolveFormats: resolveFormats,
  isFormat: isFormat,
  normalizeSafeZone: normalizeSafeZone,
  normalizeClearSpace: normalizeClearSpace
};
