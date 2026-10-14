// JSON Canonicalization Scheme, RFC 8785.
//
// - Object members are sorted by the UTF-16 code units of their names,
//   which is what Array.prototype.sort() does for strings.
// - Strings and numbers use the ECMAScript JSON serialisation that RFC 8785
//   is built on. Non-finite numbers and lone surrogates are rejected (I-JSON).
// - Only plain JSON data is accepted: no undefined, functions, BigInt,
//   symbols, class instances or sparse arrays.

const MAX_DEPTH = 32;

export class CanonicalizationError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'CanonicalizationError';
    this.code = code;
  }
}

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** @param {string} text */
export function isWellFormed(text) {
  return typeof text.isWellFormed === 'function' ? text.isWellFormed() : !LONE_SURROGATE.test(text);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalize(value) {
  return serialize(value, 0);
}

/**
 * @param {unknown} value
 * @returns {Uint8Array}
 */
export function canonicalBytes(value) {
  return new TextEncoder().encode(canonicalize(value));
}

/**
 * @param {unknown} value
 * @param {number} depth
 * @returns {string}
 */
function serialize(value, depth) {
  if (depth > MAX_DEPTH) throw new CanonicalizationError('too-deep', `nesting deeper than ${MAX_DEPTH}`);
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new CanonicalizationError('not-finite', 'numbers must be finite');
      return JSON.stringify(value);
    case 'string':
      if (!isWellFormed(value)) throw new CanonicalizationError('lone-surrogate', 'strings must be well-formed Unicode');
      return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const parts = [];
        for (let i = 0; i < value.length; i += 1) {
          if (!(i in value)) throw new CanonicalizationError('sparse-array', 'arrays must not have holes');
          parts.push(serialize(value[i], depth + 1));
        }
        return `[${parts.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new CanonicalizationError('not-plain-object', 'only plain objects can be canonicalized');
      }
      const record = /** @type {Record<string, unknown>} */ (value);
      const names = Object.keys(record).sort();
      const parts = [];
      for (const name of names) {
        if (!isWellFormed(name)) throw new CanonicalizationError('lone-surrogate', 'member names must be well-formed Unicode');
        parts.push(`${JSON.stringify(name)}:${serialize(record[name], depth + 1)}`);
      }
      return `{${parts.join(',')}}`;
    }
    default:
      throw new CanonicalizationError('not-json', `${typeof value} is not JSON data`);
  }
}
