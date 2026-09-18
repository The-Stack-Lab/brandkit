/**
 * What "not yet defined" means, in one place.
 *
 * `generate` writes `__TODO:` markers for anything it cannot measure, `build`
 * refuses to ship a guide that still has essential ones, the exporters omit
 * them and the page renders them as a placeholder. Those four consumers were
 * each carrying their own copy of the rule, `findTodos` was byte-identical in
 * cli/generate.js and cli/build.js, and build.js hand-rolled a string test that
 * re-implemented export.js's `isUnset`. Their comments had already drifted into
 * two different wordings.
 *
 * A build gate that silently disagrees with the report that told you what to
 * fix is exactly the class of failure this release exists to remove, so the
 * rule lives here and everything requires it.
 *
 * dist/engine.js keeps its own copy on purpose: it is standalone ES5 served to
 * a browser and cannot require. That one is annotated at both ends.
 *
 * Node builtins only; no dependencies.
 */

var MARKER = '__TODO';

/**
 * Is this value still unfilled? A marker, empty, or absent.
 * Note it matches only a value that STARTS with the marker, prose that
 * mentions it (a changelog entry describing the feature) is real content.
 */
function isUnset(v) {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  var t = v.trim();
  return t === '' || t.indexOf(MARKER) === 0;
}

/**
 * Is this section blank in substance, not merely present?
 *
 * Structural emptiness matters as much as a marker: `generate` clears a section
 * that only ever held brandkit's scaffold (`logos: []`, `voice.do: []`), and
 * those carry no marker at all. A container whose own fields are all blank is
 * blank, which is why `{ brand: { label: 'Brand', items: [] } }`, a colour
 * group with a label and no swatches, counts as empty rather than passing on
 * the strength of its label.
 */
function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string') return isUnset(v);
  if (typeof v === 'number' || typeof v === 'boolean') return false;
  if (Array.isArray(v)) {
    if (!v.length) return true;
    return v.every(isBlank);
  }
  if (typeof v === 'object') {
    var keys = Object.keys(v);
    if (!keys.length) return true;
    // A label alone is not content. Ignore the descriptive keys a container
    // carries about itself and judge it on what it actually holds.
    var substantive = keys.filter(function (k) {
      return k !== 'label' && k !== 'name' && k !== 'section';
    });
    if (!substantive.length) return true;
    return substantive.every(function (k) { return isBlank(v[k]); });
  }
  return false;
}

/** Every unfilled marker in `obj`, as dotted/indexed paths. */
function findTodos(obj, prefix, out) {
  out = out || [];
  prefix = prefix || '';
  if (typeof obj === 'string') {
    if (obj.trim().indexOf(MARKER) === 0) out.push(prefix);
    return out;
  }
  if (!obj || typeof obj !== 'object') return out;
  if (Array.isArray(obj)) {
    obj.forEach(function (v, i) { findTodos(v, prefix + '[' + i + ']', out); });
    return out;
  }
  Object.keys(obj).forEach(function (k) {
    findTodos(obj[k], prefix ? prefix + '.' + k : k, out);
  });
  return out;
}

/** The top-level config section a path belongs to. */
function sectionOf(p) {
  return String(p).split(/[.[]/)[0];
}

/**
 * The fields a guide cannot sensibly be shown to a client without.
 *
 * Paths, not whole sections. Blocking on all of `brand` meant a missing
 * `brand.url` or `byline` (footer detail) hard-failed a build that worked on
 * 1.5.0. These are the ones whose absence makes the document wrong rather than
 * merely incomplete.
 */
var BLOCKING_PATHS = [
  'brand.name', 'brand.displayName', 'brand.tagline', 'brand.description',
  'voice', 'logos', 'colors', 'fonts', 'theme'
];

/** Does this path fall under a blocking field? */
function isBlocking(p) {
  for (var i = 0; i < BLOCKING_PATHS.length; i++) {
    var b = BLOCKING_PATHS[i];
    if (p === b || p.indexOf(b + '.') === 0 || p.indexOf(b + '[') === 0) return true;
  }
  return false;
}

module.exports = {
  MARKER: MARKER,
  isUnset: isUnset,
  isBlank: isBlank,
  findTodos: findTodos,
  sectionOf: sectionOf,
  BLOCKING_PATHS: BLOCKING_PATHS,
  isBlocking: isBlocking
};
