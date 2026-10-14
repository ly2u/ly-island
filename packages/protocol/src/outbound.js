// Outbound request rules (protocol section "出站请求").
//
// Every request whose address comes from someone else's data goes through
// these checks: manifests, outboxes, next pages, key logs, blog feeds and
// inbox deliveries. They fail closed: anything that cannot be parsed is refused.
//
// Address policy, checked against the IANA IPv4 and IPv6 Special-Purpose
// Address Registries as of 2026-10:
// - It is deliberately conservative. Whole blocks are refused even where
//   the registry marks a few addresses inside them as globally reachable,
//   for example 192.0.0.9 and 192.0.0.10 inside 192.0.0.0/24, and some
//   anycast assignments inside 2001::/23. Islands never need those.
// - IPv6 is allowed only inside global unicast 2000::/3, plus IPv4-mapped
//   addresses and the well-known NAT64 prefix 64:ff9b::/96, which are judged
//   by the IPv4 address they carry.
// - Networks with their own NAT64 or tunnel prefixes cannot be recognised
//   from an address alone. Self-hosted adapters must also restrict egress at
//   the network level.

import { isHttpsOrigin } from './util.js';

export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 10_000;

const FORBIDDEN_SUFFIXES = ['localhost', 'local', 'internal', 'home.arpa'];

// IPv4 ranges that are private, shared, loopback, link-local, reserved,
// documentation, benchmarking or multicast.
const IPV4_FORBIDDEN = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
].map(([base, prefix]) => ({ base: /** @type {number} */ (parseIPv4(/** @type {string} */ (base))), prefix: /** @type {number} */ (prefix) }));

/**
 * Strict dotted-quad: four decimal parts, no leading zeros.
 * @param {string} text
 * @returns {number | null} the address as an unsigned 32-bit number
 */
export function parseIPv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

/**
 * @param {string} text with or without brackets; zone ids are refused
 * @returns {number[] | null} eight 16-bit groups
 */
export function parseIPv6(text) {
  let s = text;
  if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
  if (s.length === 0 || s.includes('%')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const split = (/** @type {string} */ part) => (part === '' ? [] : part.split(':'));
  const head = split(halves[0]);
  const tail = halves.length === 2 ? split(halves[1]) : [];
  const last = halves.length === 2 ? tail : head;
  if (last.length > 0 && last[last.length - 1].includes('.')) {
    const v4 = parseIPv4(/** @type {string} */ (last.pop()));
    if (v4 === null) return null;
    last.push(((v4 >>> 16) & 0xffff).toString(16), (v4 & 0xffff).toString(16));
  }
  const groups = [...head, ...tail];
  if (!groups.every((group) => /^[0-9a-fA-F]{1,4}$/.test(group))) return null;
  const values = groups.map((group) => parseInt(group, 16));
  if (halves.length === 1) return values.length === 8 ? values : null;
  if (values.length > 7) return null;
  return [
    ...head.map((group) => parseInt(group, 16)),
    ...new Array(8 - values.length).fill(0),
    ...tail.map((group) => parseInt(group, 16)),
  ];
}

/** @param {number} address */
function isForbiddenIPv4(address) {
  return IPV4_FORBIDDEN.some(({ base, prefix }) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return ((address & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** @param {number} high @param {number} low */
function embeddedIPv4(high, low) {
  return ((high << 16) | low) >>> 0;
}

/** @param {number[]} g */
function isForbiddenIPv6(g) {
  const zeros = (/** @type {number} */ from, /** @type {number} */ to) => g.slice(from, to).every((x) => x === 0);
  // IPv4-mapped ::ffff:0:0/96 and NAT64 64:ff9b::/96 carry an IPv4 address.
  if (zeros(0, 5) && g[5] === 0xffff) return isForbiddenIPv4(embeddedIPv4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) return isForbiddenIPv4(embeddedIPv4(g[6], g[7]));
  // Everything outside global unicast 2000::/3 is refused (loopback,
  // unspecified, unique local, link-local, multicast, discard, ...).
  if ((g[0] & 0xe000) !== 0x2000) return true;
  if (g[0] === 0x2001 && g[1] < 0x0200) return true; // 2001::/23 protocol assignments, incl. Teredo
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
  if (g[0] === 0x3fff && g[1] < 0x1000) return true; // 3fff::/20 documentation
  if (g[0] === 0x2002) return isForbiddenIPv4(embeddedIPv4(g[1], g[2])); // 6to4
  return false;
}

/**
 * True when an IP address must not be contacted. Unparseable input counts as forbidden.
 * @param {string} address IPv4 dotted-quad or IPv6 (brackets allowed)
 */
export function isForbiddenAddress(address) {
  if (typeof address !== 'string') return true;
  const v4 = parseIPv4(address);
  if (v4 !== null) return isForbiddenIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6 !== null) return isForbiddenIPv6(v6);
  return true;
}

/**
 * @param {unknown} value
 * @param {{ sameOriginAs?: string }} [options]
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function checkOutboundUrl(value, { sameOriginAs } = {}) {
  if (typeof value !== 'string' || value.length > 2048) return { ok: false, reason: 'invalid-url' };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'not-https' };
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'credentials-in-url' };
  if (url.port !== '') return { ok: false, reason: 'non-default-port' };

  const host = url.hostname;
  if (host.startsWith('[')) {
    if (isForbiddenAddress(host)) return { ok: false, reason: 'forbidden-address' };
  } else if (/^[\d.]+$/.test(host)) {
    // The URL parser already turned forms like 0x7f.1 or 2130706433 into dotted-quad.
    if (isForbiddenAddress(host)) return { ok: false, reason: 'forbidden-address' };
  } else {
    if (host.endsWith('.')) return { ok: false, reason: 'trailing-dot-host' };
    if (!host.includes('.') && !FORBIDDEN_SUFFIXES.includes(host)) return { ok: false, reason: 'single-label-host' };
    if (FORBIDDEN_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      return { ok: false, reason: 'forbidden-host' };
    }
  }

  if (sameOriginAs !== undefined && url.origin !== sameOriginAs) return { ok: false, reason: 'cross-origin' };
  return { ok: true, url };
}

/**
 * For self-hosted adapters: check every address a host name resolved to,
 * then connect to one of these checked addresses (never resolve again),
 * which defeats DNS rebinding.
 * @param {string[]} addresses
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function checkResolvedAddresses(addresses) {
  if (!Array.isArray(addresses) || addresses.length === 0) return { ok: false, reason: 'no-address' };
  if (addresses.some(isForbiddenAddress)) return { ok: false, reason: 'forbidden-address' };
  return { ok: true };
}

/**
 * Inbox deliveries (POST) never follow redirects. GET follows at most
 * MAX_REDIRECTS, each on the same origin and checked again.
 * @param {{ method: string, from: string, location: string | null, hops: number }} redirect
 *   hops: redirects already followed for this request
 * @returns {{ ok: true, url: URL } | { ok: false, reason: string }}
 */
export function checkRedirect({ method, from, location, hops }) {
  if (method.toUpperCase() !== 'GET') return { ok: false, reason: 'redirect-not-followed' };
  if (hops >= MAX_REDIRECTS) return { ok: false, reason: 'too-many-redirects' };
  if (typeof location !== 'string' || location === '') return { ok: false, reason: 'invalid-url' };
  let target;
  try {
    target = new URL(location, from);
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  return checkOutboundUrl(target.href, { sameOriginAs: new URL(from).origin });
}

// The only headers a protocol request may carry. Everything else is refused:
// Cookie, Authorization, Cloudflare Access headers, custom API or AI tokens,
// forwarding headers. Requests are built from this list, never by copying
// the headers of an incoming request.
export const ALLOWED_HEADERS = Object.freeze(['accept', 'content-type', 'if-modified-since', 'if-none-match', 'user-agent']);

const ACCEPT = Object.freeze({
  read: 'application/json',
  feed: 'application/atom+xml, application/rss+xml, application/feed+json, application/xml;q=0.9, text/xml;q=0.8',
  deliver: 'application/json',
});

/** @param {unknown} value */
function isSafeHeaderValue(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 1024 && /^[\x20-\x7e]+$/.test(value);
}

/**
 * Builds the headers of a protocol request from scratch.
 * @param {{
 *   kind: 'read' | 'feed' | 'deliver',
 *   self: string,
 *   etag?: string | null,
 *   lastModified?: string | null,
 * }} options
 *   kind: "read" for manifests, outboxes, friends lists and key logs; "feed"
 *   for RSS, Atom or JSON Feed of plain blogs; "deliver" for an inbox POST.
 *   self: this island's origin, named in the User-Agent.
 *   etag, lastModified: from the previous response, for conditional reads.
 * @returns {Record<string, string>}
 */
export function buildOutboundHeaders({ kind, self, etag = null, lastModified = null }) {
  if (!Object.hasOwn(ACCEPT, kind)) throw new TypeError('kind must be "read", "feed" or "deliver"');
  if (!isHttpsOrigin(self)) throw new TypeError('self must be this island origin');
  /** @type {Record<string, string>} */
  const headers = { accept: ACCEPT[/** @type {keyof typeof ACCEPT} */ (kind)], 'user-agent': `islands/0 (+${self})` };
  if (kind === 'deliver') {
    headers['content-type'] = 'application/json';
  } else {
    if (etag !== null) {
      if (!isSafeHeaderValue(etag)) throw new TypeError('etag is not a safe header value');
      headers['if-none-match'] = etag;
    }
    if (lastModified !== null) {
      if (!isSafeHeaderValue(lastModified)) throw new TypeError('lastModified is not a safe header value');
      headers['if-modified-since'] = lastModified;
    }
  }
  return headers;
}

/**
 * Last check before sending: only headers from ALLOWED_HEADERS, with plain
 * printable values. Use buildOutboundHeaders() to make them.
 * @param {Record<string, string> | Iterable<[string, string]>} headers
 * @returns {{ ok: true } | { ok: false, reason: string, header: string }}
 */
export function checkOutboundHeaders(headers) {
  const entries = Symbol.iterator in Object(headers) ? [.../** @type {Iterable<[string, string]>} */ (headers)] : Object.entries(headers);
  for (const [name, value] of entries) {
    if (!ALLOWED_HEADERS.includes(String(name).toLowerCase())) return { ok: false, reason: 'header-not-allowed', header: name };
    if (!isSafeHeaderValue(value)) return { ok: false, reason: 'unsafe-header-value', header: name };
  }
  return { ok: true };
}
