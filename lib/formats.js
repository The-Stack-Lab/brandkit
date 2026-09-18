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
  if (typeof entry === 'string') entry = { preset: entry };
  if (!isObject(entry)) return null;
  var out = {};
  if (entry.preset !== undefined && entry.preset !== null && entry.preset !== '') {
    var found = lookupPreset(entry.preset);
    if (found) {
      out.preset = found.key;
      Object.keys(found.preset).forEach(function (k) { out[k] = found.preset[k]; });
    } else {
      out.unknownPreset = String(entry.preset);
    }
  }
  Object.keys(entry).forEach(function (k) {
    if (k === 'preset') return;
    if (entry[k] === undefined || entry[k] === null) return;
    out[k] = entry[k];
  });
  if (out.unit === undefined && (out.width !== undefined || out.height !== undefined)) out.unit = 'px';
  if (out.kind !== undefined && FORMAT_KINDS.indexOf(out.kind) === -1) out.kind = 'other';
  return out;
}

function resolveFormats(config) {
  var list = config && config.formats;
  if (!Array.isArray(list)) return [];
  return list.map(resolveFormat).filter(function (f) { return f !== null; });
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
  var out = {};
  var any = all !== null;
  ['top', 'right', 'bottom', 'left'].forEach(function (side) {
    if (typeof src[side] === 'number') { out[side] = src[side]; any = true; }
    else out[side] = all !== null ? all : 0;
  });
  if (!any) return null;
  out.unit = src.unit || unit || 'px';
  return out;
}

/** clearSpace: a sentence, or { rule, ratio }. Returns { rule, ratio } or null. */
function normalizeClearSpace(v) {
  if (typeof v === 'string') return v.trim() ? { rule: v } : null;
  if (!isObject(v)) return null;
  var out = {};
  if (typeof v.rule === 'string' && v.rule.trim()) out.rule = v.rule;
  if (typeof v.ratio === 'number') out.ratio = v.ratio;
  return Object.keys(out).length ? out : null;
}

module.exports = {
  FORMAT_PRESETS: FORMAT_PRESETS,
  PRESET_ALIASES: PRESET_ALIASES,
  FORMAT_KINDS: FORMAT_KINDS,
  resolveFormat: resolveFormat,
  resolveFormats: resolveFormats,
  normalizeSafeZone: normalizeSafeZone,
  normalizeClearSpace: normalizeClearSpace
};
