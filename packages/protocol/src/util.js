// Small checks shared by the validators. Every check is total: it returns
// false for anything unexpected instead of throwing.

/** @typedef {{ path: string, code: string, message: string }} Issue */

export const PROTOCOL = 'islands/0';

/** @param {unknown} value @returns {value is Record<string, any>} */
export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** @param {unknown} value */
export function codePoints(value) {
  return typeof value === 'string' ? [...value].length : -1;
}

/**
 * @param {unknown} value
 * @param {{ min?: number, max: number }} limits counted in Unicode code points
 */
export function isText(value, { min = 0, max }) {
  const length = codePoints(value);
  return length >= min && length <= max;
}

// Address syntax (protocol section "地址的写法"). The JSON Schemas use the
// same rule (schema/common.schema.json); fixtures/addresses.json keeps the two
// in step.
//
// Host: a DNS name of at least two labels, lowercase letters, digits and
// inner hyphens, each label 1 to 63 characters, the last label letters only,
// 253 characters at most. No IP literals, no internationalised (xn--) labels
// in v0, no trailing dot. The rest of a URL is printable ASCII.
const LABEL = '(?!xn--)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^(?:${LABEL}\\.)+[a-z]{2,63}$`);

/** @param {string} host */
export function isProtocolHost(host) {
  return host.length <= 253 && HOST.test(host);
}

/**
 * Parses an https URL written the way the protocol requires: printable
 * ASCII, a canonical origin (see isProtocolHost), no credentials, no port,
 * then nothing or a path, query or fragment.
 * @param {unknown} value
 * @returns {URL | null}
 */
export function parseHttpsUrl(value) {
  if (typeof value !== 'string' || value.length > 2048 || !/^[\x21-\x7e]+$/.test(value)) return null;
  const match = /^https:\/\/([^/?#]*)(.*)$/.exec(value);
  if (!match || !isProtocolHost(match[1]) || (match[2] !== '' && !/^[/?#]/.test(match[2]))) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // Belt and braces: the URL parser must agree on the origin.
  if (url.origin !== `https://${match[1]}`) return null;
  return url;
}

/**
 * A canonical https origin such as "https://example.org": lowercase host,
 * no path, no trailing slash, no default port, no credentials.
 * @param {unknown} value
 */
export function isHttpsOrigin(value) {
  const url = parseHttpsUrl(value);
  return url !== null && url.origin === value;
}

/** @param {unknown} value */
export function originOf(value) {
  return parseHttpsUrl(value)?.origin ?? null;
}

/**
 * True when `value` is an https URL whose origin is `origin`.
 * @param {unknown} value
 * @param {string} origin
 */
export function isUrlOnOrigin(value, origin) {
  const url = parseHttpsUrl(value);
  return url !== null && url.origin === origin;
}

/**
 * A key id is "<origin>#<name>", e.g. "https://example.org#k1",
 * where the name is 1 to 64 of [A-Za-z0-9._-].
 * @param {unknown} value
 * @param {string} origin
 */
export function isKeyId(value, origin) {
  if (typeof value !== 'string' || !value.startsWith(`${origin}#`)) return false;
  return /^[A-Za-z0-9._-]{1,64}$/.test(value.slice(origin.length + 1));
}

/**
 * The origin part of a key id, or null.
 * @param {unknown} value
 */
export function keyIdOrigin(value) {
  if (typeof value !== 'string') return null;
  const hash = value.indexOf('#');
  if (hash < 0) return null;
  const origin = value.slice(0, hash);
  return isHttpsOrigin(origin) && isKeyId(value, origin) ? origin : null;
}

const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** @param {number} year @param {number} month */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** @param {number} year @param {number} month @param {number} day */
function isValidDay(year, month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/**
 * RFC 3339 date-time with a time zone (Z or ±hh:mm). Leap seconds are not accepted.
 * @param {unknown} value
 */
export function isDateTime(value) {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi, s, , zone, zh, zm] = match;
  if (!isValidDay(Number(y), Number(mo), Number(d))) return false;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s) > 59) return false;
  if (zone !== 'Z' && (Number(zh) > 23 || Number(zm) > 59)) return false;
  return Number.isFinite(Date.parse(value));
}

/** @param {unknown} value */
export function isDate(value) {
  if (typeof value !== 'string') return false;
  const match = DATE.exec(value);
  return match !== null && isValidDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** @param {unknown} value e.g. "2026-W42" */
export function isIsoWeek(value) {
  return typeof value === 'string' && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(value);
}

/** @param {unknown} value a BCP 47 language tag, checked loosely */
export function isLanguageTag(value) {
  return typeof value === 'string' && value.length <= 35 && /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(value);
}

/** @param {unknown} value */
export function isColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** @param {string} value */
export function timeOf(value) {
  return Date.parse(value);
}

/** @param {unknown} value */
export function utf8Length(value) {
  return new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

/**
 * Collects issues with a common path prefix.
 */
export class Issues {
  constructor() {
    /** @type {Issue[]} */
    this.list = [];
  }

  /** @param {string} path @param {string} code @param {string} message */
  add(path, code, message) {
    this.list.push({ path, code, message });
  }

  get ok() {
    return this.list.length === 0;
  }

  /** @param {string} code */
  has(code) {
    return this.list.some((issue) => issue.code === code);
  }
}
