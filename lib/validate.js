/**
 * Validate a config against config.schema.json.
 *
 * Until now the schema was editor-only: nothing checked a config at build
 * or export, so a wrong type surfaced (if at all) as a blank section in the
 * rendered guide or a missing token in the exports.
 *
 * Zero dependencies, so this implements the draft-07 subset the schema
 * actually uses: type, required, properties, additionalProperties, items,
 * enum, const, $ref (local #/definitions only), oneOf, anyOf, allOf, minimum,
 * exclusiveMinimum, minLength, pattern, minItems, maxItems. A keyword outside
 * that set is ignored, not guessed at; test/schema.test.js fails if the schema
 * starts using one.
 *
 * Two severities, split where the renderer splits:
 *   errors    the wrong shape: a wrong type or a missing required field. The
 *             engine reads `s.color` off a gradient stop; a stop that is a bare
 *             string renders as an empty dot. `build` and `export` stop.
 *   warnings  the right shape with a value the schema does not expect (outside
 *             an enum, failing a pattern, below a minimum), or a key the schema
 *             does not describe. The engine copes with both: an unknown rating
 *             renders as text with the fail style, an unknown key is ignored.
 *             Printed, never fatal. Shipped guides carry free-text ratings
 *             ("Fail: never use") and rgba neutrals; failing them on upgrade
 *             would break builds that render correctly today.
 *
 * `__TODO` is brandkit's own unset marker (see isUnset in lib/export.js), and
 * reads as absent here too: a half-filled guide is unfinished, not malformed.
 */
var fs = require('fs');
var path = require('path');

var SCHEMA_PATH = path.join(__dirname, '..', 'config.schema.json');
var SUPPORTED = [
  '$schema', '$id', 'title', 'description', 'definitions', 'default', 'examples',
  'type', 'required', 'properties', 'additionalProperties', 'items', 'enum', 'const',
  '$ref', 'oneOf', 'anyOf', 'allOf', 'minimum', 'exclusiveMinimum', 'minLength',
  'pattern', 'minItems', 'maxItems'
];

var cached = null;
function loadSchema() {
  if (!cached) cached = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return cached;
}

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;   // object, string, number, boolean
}

function matchesType(v, t) {
  if (t === 'integer') return typeof v === 'number' && isFinite(v) && Math.floor(v) === v;
  if (t === 'number') return typeof v === 'number' && isFinite(v);
  return typeOf(v) === t;
}

function at(p) { return p || '(root)'; }
function child(p, key) {
  if (typeof key === 'number') return p + '[' + key + ']';
  return p ? p + '.' + key : key;
}

function resolveRef(root, ref) {
  var m = /^#\/definitions\/(.+)$/.exec(ref);
  if (!m || !root.definitions || !root.definitions[m[1]]) {
    throw new Error('config.schema.json: unresolvable $ref ' + ref);
  }
  return root.definitions[m[1]];
}

var UNSET = '__TODO';

function short(v) {
  var s = JSON.stringify(v);
  return s && s.length > 40 ? s.slice(0, 37) + '...' : s;
}

/**
 * Walk one value against one schema node. Appends to out.errors / out.warnings.
 * Unknown-key warnings from a oneOf/anyOf branch are kept only for the branch
 * that matched, so a value is not warned about for shapes it is not using.
 */
function walk(root, schema, value, p, out) {
  if (schema === true || schema === undefined) return;
  if (schema === false) { out.errors.push(at(p) + ': not allowed here'); return; }

  if (schema.$ref) { walk(root, resolveRef(root, schema.$ref), value, p, out); return; }
  if (value === UNSET) return;

  if (schema.type !== undefined) {
    var types = Array.isArray(schema.type) ? schema.type : [schema.type];
    var ok = types.some(function (t) { return matchesType(value, t); });
    if (!ok) {
      out.errors.push(at(p) + ': expected ' + types.join(' or ') + ', got ' + typeOf(value) + ' ' + short(value));
      return;   // the rest of the keywords describe a shape this value is not
    }
  }

  // From here to the array/object section: value constraints, warnings only.
  var warn = out.warnings;
  if (schema.enum && !schema.enum.some(function (e) { return JSON.stringify(e) === JSON.stringify(value); })) {
    warn.push(at(p) + ': ' + short(value) + ' is not one of ' + schema.enum.map(short).join(', '));
  }
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) {
    warn.push(at(p) + ': must be ' + short(schema.const));
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      warn.push(at(p) + ': ' + value + ' is below the minimum ' + schema.minimum);
    }
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) {
      warn.push(at(p) + ': ' + value + ' must be greater than ' + schema.exclusiveMinimum);
    }
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      warn.push(at(p) + ': must be at least ' + schema.minLength + ' character(s)');
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      warn.push(at(p) + ': ' + short(value) + ' does not match ' + schema.pattern);
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      warn.push(at(p) + ': needs at least ' + schema.minItems + ' item(s)');
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      warn.push(at(p) + ': allows at most ' + schema.maxItems + ' item(s)');
    }
    if (Array.isArray(schema.items)) {
      schema.items.forEach(function (s, i) {
        if (i < value.length) walk(root, s, value[i], child(p, i), out);
      });
    } else if (schema.items) {
      value.forEach(function (v, i) { walk(root, schema.items, v, child(p, i), out); });
    }
  }

  if (typeOf(value) === 'object') {
    (schema.required || []).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(value, k)) out.errors.push(child(p, k) + ': required');
    });
    var props = schema.properties || {};
    var extra = schema.additionalProperties;
    Object.keys(value).forEach(function (k) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        walk(root, props[k], value[k], child(p, k), out);
      } else if (extra === false) {
        out.errors.push(child(p, k) + ': unknown key (not allowed here)');
      } else if (extra && extra !== true) {
        walk(root, extra, value[k], child(p, k), out);
      } else if (schema.properties) {
        // Open object, but it describes its keys: an undescribed one is
        // allowed and usually a typo.
        warn.push(child(p, k) + ': unknown key');
      }
    });
  }

  if (schema.allOf) schema.allOf.forEach(function (s) { walk(root, s, value, p, out); });

  if (schema.oneOf || schema.anyOf) {
    var branches = schema.oneOf || schema.anyOf;
    var results = branches.map(function (s) {
      var r = { errors: [], warnings: [] };
      walk(root, s, value, p, r);
      return r;
    });
    var passing = results.filter(function (r) { return !r.errors.length; });
    if (schema.oneOf && passing.length > 1) {
      out.errors.push(at(p) + ': matches more than one allowed shape');
    } else if (passing.length) {
      out.warnings.push.apply(out.warnings, passing[0].warnings);
    } else {
      // Report the branch that came closest: its errors are the useful ones.
      // A branch whose own type did not match is furthest of all ("expected
      // string" says nothing to someone who wrote an object).
      var wrongType = at(p) + ': expected ';
      var score = function (r) {
        return (r.errors[0] && r.errors[0].indexOf(wrongType) === 0 ? 1e6 : 0) + r.errors.length;
      };
      var best = results.slice().sort(function (a, b) { return score(a) - score(b); })[0];
      out.errors.push.apply(out.errors, best.errors);
    }
  }
}

/** Keywords in the schema this validator does not implement. Empty is correct. */
function unsupportedKeywords(schema) {
  var found = {};
  (function scan(node, inProps) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(function (n) { scan(n, false); }); return; }
    Object.keys(node).forEach(function (k) {
      if (inProps) { scan(node[k], false); return; }   // property names, not keywords
      if (SUPPORTED.indexOf(k) === -1) found[k] = true;
      scan(node[k], k === 'properties' || k === 'definitions');
    });
  })(schema, false);
  return Object.keys(found).sort();
}

function validateConfig(config, schema) {
  var root = schema || loadSchema();
  var out = { errors: [], warnings: [] };
  walk(root, root, config, '', out);
  return { valid: out.errors.length === 0, errors: out.errors, warnings: out.warnings };
}

/**
 * Print a result the way build and export report it. Returns true if the
 * caller should stop.
 */
function report(result, opts) {
  var label = (opts && opts.label) || 'config.json';
  if (result.warnings.length) {
    console.log('');
    console.log('  ' + label + ': ' + result.warnings.length + ' warning(s), not fatal (unexpected values, or keys the schema does not describe; check for typos):');
    result.warnings.forEach(function (w) { console.log('    ' + w); });
  }
  if (result.errors.length) {
    console.error('');
    console.error('  ' + label + ' does not match config.schema.json (' + result.errors.length + ' problem(s)):');
    result.errors.forEach(function (e) { console.error('    ' + e); });
    console.error('');
    return true;
  }
  return false;
}

module.exports = {
  validateConfig: validateConfig,
  unsupportedKeywords: unsupportedKeywords,
  report: report,
  SCHEMA_PATH: SCHEMA_PATH
};
