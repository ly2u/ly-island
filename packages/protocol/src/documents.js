// Public documents an island serves (protocol section "公开数据"):
// the manifest, the outbox, the friends list and the key log.

import { DIRECTED_TYPES, isDirectedType, validateActivity } from './activity.js';
import { isBase64urlOfLength } from './base64url.js';
import { canonicalBytes } from './canonicalize.js';
import {
  Issues,
  PROTOCOL,
  isColor,
  isDate,
  isDateTime,
  isHttpsOrigin,
  isIsoWeek,
  isKeyId,
  isLanguageTag,
  isPlainObject,
  isText,
  isUrlOnOrigin,
  parseHttpsUrl,
  timeOf,
} from './util.js';

/** @typedef {import('./util.js').Issue} Issue */

export const MANIFEST_PATH = '/.well-known/island.json';
export const LINK_NAMES = Object.freeze(['home', 'outbox', 'friends', 'feed', 'inbox', 'compose', 'keys']);
export const ACCEPT_VALUES = Object.freeze(['none', 'friends', 'signed']);

export const DOCUMENT_LIMITS = Object.freeze({
  manifestBytes: 64 * 1024,
  outboxBytes: 256 * 1024,
  outboxItems: 50,
  keys: 8,
  name: 100,
  summary: 1000,
  languages: 10,
  colors: 8,
  aliases: 8,
  activeWeeks: 60,
  unlocked: 256,
  friends: 1000,
  keyLogItems: 256,
});

/**
 * @param {unknown} value
 * @param {number} max
 * @param {Issues} issues
 * @param {string} label
 */
function checkSize(value, max, issues, label) {
  try {
    if (canonicalBytes(value).length > max) issues.add('', 'too-large', `${label} must be at most ${max} bytes`);
  } catch (error) {
    issues.add('', 'not-canonicalizable', /** @type {Error} */ (error).message);
  }
}

/**
 * @param {unknown} manifest
 * @param {{ fetchedOrigin?: string }} [context] the origin it was read from
 * @returns {{ ok: boolean, issues: Issue[] }}
 */
export function validateManifest(manifest, { fetchedOrigin } = {}) {
  const issues = new Issues();
  if (!isPlainObject(manifest)) {
    issues.add('', 'not-object', 'a manifest must be a JSON object');
    return { ok: false, issues: issues.list };
  }
  const m = manifest;

  if (m.protocol !== PROTOCOL) issues.add('protocol', 'unsupported-protocol', `protocol must be "${PROTOCOL}"`);

  const idOk = isHttpsOrigin(m.id);
  if (!idOk) issues.add('id', 'invalid-id', 'id must be a canonical https origin');
  else if (fetchedOrigin !== undefined && m.id !== fetchedOrigin) {
    issues.add('id', 'id-mismatch', 'id must equal the origin the manifest was read from');
  }

  if (!isText(m.name, { min: 1, max: DOCUMENT_LIMITS.name })) {
    issues.add('name', 'invalid-name', `name must be 1 to ${DOCUMENT_LIMITS.name} characters`);
  }
  if (m.summary !== undefined && !isText(m.summary, { min: 1, max: DOCUMENT_LIMITS.summary })) {
    issues.add('summary', 'invalid-summary', `summary must be 1 to ${DOCUMENT_LIMITS.summary} characters`);
  }
  if (
    m.language !== undefined &&
    (!Array.isArray(m.language) ||
      m.language.length > DOCUMENT_LIMITS.languages ||
      !m.language.every(isLanguageTag))
  ) {
    issues.add('language', 'invalid-language', 'language must be a list of language tags');
  }

  if (idOk) {
    if (m.icon !== undefined) checkLink(m.icon, m.id, 'icon', issues);
    checkKeys(m.keys, m.id, issues);
    checkLinks(m.links, m.id, issues);
    checkAliases(m, issues);
  }

  if (m.accepts !== undefined) {
    if (!isPlainObject(m.accepts)) {
      issues.add('accepts', 'invalid-accepts', 'accepts must be an object');
    } else {
      for (const type of DIRECTED_TYPES) {
        const value = m.accepts[type];
        if (value !== undefined && !ACCEPT_VALUES.includes(value)) {
          issues.add(`accepts/${type}`, 'invalid-accepts', `accepts values are ${ACCEPT_VALUES.join(', ')}`);
        }
      }
    }
  }

  if (m.appearance !== undefined) checkAppearance(m.appearance, issues);
  if (m.stats !== undefined) checkStats(m.stats, issues);

  if (m.discoverable !== undefined && typeof m.discoverable !== 'boolean') {
    issues.add('discoverable', 'invalid-discoverable', 'discoverable must be true or false');
  }
  if (m.ai !== undefined) {
    if (
      !isPlainObject(m.ai) ||
      (m.ai.read !== undefined && typeof m.ai.read !== 'boolean') ||
      (m.ai.train !== undefined && typeof m.ai.train !== 'boolean')
    ) {
      issues.add('ai', 'invalid-ai', 'ai must be { read?: boolean, train?: boolean }');
    }
  }

  if (!isDateTime(m.updated)) issues.add('updated', 'invalid-time', 'updated must be an RFC 3339 date-time');

  checkSize(m, DOCUMENT_LIMITS.manifestBytes, issues, 'a manifest');
  return { ok: issues.ok, issues: issues.list };
}

/** @param {unknown} value @param {string} origin @param {string} path @param {Issues} issues */
function checkLink(value, origin, path, issues) {
  if (parseHttpsUrl(value) === null) issues.add(path, 'invalid-link', `${path} must be an https URL`);
  else if (!isUrlOnOrigin(value, origin)) issues.add(path, 'cross-origin-link', `${path} must be on the island origin`);
}

/** @param {unknown} keys @param {string} origin @param {Issues} issues */
function checkKeys(keys, origin, issues) {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > DOCUMENT_LIMITS.keys) {
    issues.add('keys', 'invalid-keys', `keys must list 1 to ${DOCUMENT_LIMITS.keys} keys`);
    return;
  }
  const ids = new Set();
  const publicKeys = new Set();
  keys.forEach((key, index) => {
    if (
      !isPlainObject(key) ||
      !isKeyId(key.id, origin) ||
      key.type !== 'Ed25519' ||
      !isBase64urlOfLength(key.publicKey, 32)
    ) {
      issues.add(`keys/${index}`, 'invalid-key', 'a key is { id: "<origin>#name", type: "Ed25519", publicKey }');
      return;
    }
    if (ids.has(key.id) || publicKeys.has(key.publicKey)) {
      issues.add(`keys/${index}`, 'duplicate-key', 'key ids and public keys must be unique');
    }
    ids.add(key.id);
    publicKeys.add(key.publicKey);
  });
}

/** @param {unknown} links @param {string} origin @param {Issues} issues */
function checkLinks(links, origin, issues) {
  if (!isPlainObject(links)) {
    issues.add('links', 'invalid-links', 'links must be an object');
    return;
  }
  if (links.outbox === undefined) issues.add('links/outbox', 'missing-outbox', 'links.outbox is required');
  for (const name of LINK_NAMES) {
    if (links[name] !== undefined) checkLink(links[name], origin, `links/${name}`, issues);
  }
}

/** @param {Record<string, any>} m @param {Issues} issues */
function checkAliases(m, issues) {
  if (m.alsoKnownAs !== undefined) {
    if (
      !Array.isArray(m.alsoKnownAs) ||
      m.alsoKnownAs.length > DOCUMENT_LIMITS.aliases ||
      !m.alsoKnownAs.every((/** @type {unknown} */ alias) => isHttpsOrigin(alias) && alias !== m.id)
    ) {
      issues.add('alsoKnownAs', 'invalid-alias', 'alsoKnownAs must list other https origins');
    }
  }
  if (m.movedTo !== undefined && (!isHttpsOrigin(m.movedTo) || m.movedTo === m.id)) {
    issues.add('movedTo', 'invalid-moved-to', 'movedTo must be another https origin');
  }
}

/** @param {unknown} appearance @param {Issues} issues */
function checkAppearance(appearance, issues) {
  if (
    !isPlainObject(appearance) ||
    (appearance.seed !== undefined && !isText(appearance.seed, { min: 1, max: 64 })) ||
    (appearance.colors !== undefined &&
      (!Array.isArray(appearance.colors) ||
        appearance.colors.length > DOCUMENT_LIMITS.colors ||
        !appearance.colors.every(isColor)))
  ) {
    issues.add('appearance', 'invalid-appearance', 'appearance is { seed?, colors?: ["#rrggbb", ...] }');
  }
}

/** @param {unknown} value */
function isCount(value) {
  return Number.isInteger(value) && /** @type {number} */ (value) >= 0 && /** @type {number} */ (value) <= 1e9;
}

/** @param {unknown} stats @param {Issues} issues */
function checkStats(stats, issues) {
  if (!isPlainObject(stats)) {
    issues.add('stats', 'invalid-stats', 'stats must be an object');
    return;
  }
  if (
    stats.records !== undefined &&
    (!isPlainObject(stats.records) ||
      !Object.entries(stats.records).every(([kind, count]) => /^[a-z][a-z0-9-]{0,31}$/.test(kind) && isCount(count)))
  ) {
    issues.add('stats/records', 'invalid-stats', 'records maps kinds to counts');
  }
  if (stats.bottles !== undefined && !isCount(stats.bottles)) {
    issues.add('stats/bottles', 'invalid-stats', 'bottles must be a count');
  }
  for (const field of ['firstRecord', 'lastRecord']) {
    if (stats[field] !== undefined && !isDate(stats[field])) {
      issues.add(`stats/${field}`, 'invalid-stats', `${field} must be a date`);
    }
  }
  if (
    stats.activeWeeks !== undefined &&
    (!Array.isArray(stats.activeWeeks) ||
      stats.activeWeeks.length > DOCUMENT_LIMITS.activeWeeks ||
      !stats.activeWeeks.every(isIsoWeek))
  ) {
    issues.add('stats/activeWeeks', 'invalid-stats', 'activeWeeks must be ISO weeks such as "2026-W42"');
  }
  if (stats.growth !== undefined) {
    const g = stats.growth;
    if (
      !isPlainObject(g) ||
      !isText(g.rules, { min: 1, max: 64 }) ||
      !isCount(g.points) ||
      !isText(g.stage, { min: 1, max: 32 }) ||
      (g.unlocked !== undefined &&
        (!Array.isArray(g.unlocked) ||
          g.unlocked.length > DOCUMENT_LIMITS.unlocked ||
          !g.unlocked.every((/** @type {unknown} */ item) => isText(item, { min: 1, max: 64 }))))
    ) {
      issues.add('stats/growth', 'invalid-stats', 'growth is { rules, points, stage, unlocked? }');
    }
  }
}

/**
 * Common header of outbox, friends and key log documents.
 * @param {Record<string, any>} doc
 * @param {Issues} issues
 */
function checkHeader(doc, issues) {
  if (doc.protocol !== PROTOCOL) issues.add('protocol', 'unsupported-protocol', `protocol must be "${PROTOCOL}"`);
  const ownerOk = isHttpsOrigin(doc.owner);
  if (!ownerOk) issues.add('owner', 'invalid-owner', 'owner must be a canonical https origin');
  if (parseHttpsUrl(doc.id) === null) issues.add('id', 'invalid-id', 'id must be an https URL');
  else if (ownerOk && !isUrlOnOrigin(doc.id, doc.owner)) issues.add('id', 'cross-origin-link', 'id must be on the owner origin');
  if (!isDateTime(doc.updated)) issues.add('updated', 'invalid-time', 'updated must be an RFC 3339 date-time');
  return ownerOk;
}

/**
 * The outbox is valid when its own fields are; items are judged one by one so
 * a reader can skip a bad item. `valid` is true only when every item is valid too.
 * @param {unknown} outbox
 * @returns {{ ok: boolean, valid: boolean, issues: Issue[], items: { ok: boolean, known: boolean, issues: Issue[] }[] }}
 */
export function validateOutbox(outbox) {
  const issues = new Issues();
  if (!isPlainObject(outbox)) {
    issues.add('', 'not-object', 'an outbox must be a JSON object');
    return { ok: false, valid: false, issues: issues.list, items: [] };
  }
  const ownerOk = checkHeader(outbox, issues);
  if (outbox.next !== undefined && ownerOk) checkLink(outbox.next, outbox.owner, 'next', issues);

  /** @type {{ ok: boolean, known: boolean, issues: Issue[] }[]} */
  const items = [];
  if (!Array.isArray(outbox.items) || outbox.items.length > DOCUMENT_LIMITS.outboxItems) {
    issues.add('items', 'invalid-items', `items must be a list of at most ${DOCUMENT_LIMITS.outboxItems} activities`);
  } else {
    for (const item of outbox.items) {
      const result = validateActivity(item);
      const itemIssues = new Issues();
      itemIssues.list.push(...result.issues);
      if (isPlainObject(item) && ownerOk && item.actor !== outbox.owner) {
        itemIssues.add('actor', 'foreign-item', 'outbox items must be written by the owner');
      }
      if (isPlainObject(item) && isDirectedType(item.type)) {
        itemIssues.add('type', 'directed-in-outbox', 'directed activities are never published in an outbox');
      }
      items.push({ ok: itemIssues.ok, known: result.known, issues: itemIssues.list });
    }
  }
  checkSize(outbox, DOCUMENT_LIMITS.outboxBytes, issues, 'an outbox page');
  return { ok: issues.ok, valid: issues.ok && items.every((item) => item.ok), issues: issues.list, items };
}

/**
 * @param {unknown} friends
 * @returns {{ ok: boolean, issues: Issue[] }}
 */
export function validateFriends(friends) {
  const issues = new Issues();
  if (!isPlainObject(friends)) {
    issues.add('', 'not-object', 'a friends list must be a JSON object');
    return { ok: false, issues: issues.list };
  }
  checkHeader(friends, issues);
  if (!Array.isArray(friends.items) || friends.items.length > DOCUMENT_LIMITS.friends) {
    issues.add('items', 'invalid-items', `items must be a list of at most ${DOCUMENT_LIMITS.friends} entries`);
    return { ok: false, issues: issues.list };
  }
  const seen = new Set();
  friends.items.forEach((/** @type {unknown} */ entry, index) => {
    const path = `items/${index}`;
    if (!isPlainObject(entry) || !isHttpsOrigin(entry.id) || entry.id === friends.owner) {
      issues.add(path, 'invalid-friend', 'each entry needs an https origin other than the owner');
      return;
    }
    if (seen.has(entry.id)) issues.add(path, 'duplicate-friend', 'each island appears once');
    seen.add(entry.id);
    if (entry.name !== undefined && !isText(entry.name, { min: 1, max: DOCUMENT_LIMITS.name })) {
      issues.add(`${path}/name`, 'invalid-name', `name must be 1 to ${DOCUMENT_LIMITS.name} characters`);
    }
    if (entry.since !== undefined && !isDate(entry.since)) {
      issues.add(`${path}/since`, 'invalid-time', 'since must be a date');
    }
    if (entry.feed !== undefined && parseHttpsUrl(entry.feed) === null) {
      issues.add(`${path}/feed`, 'invalid-link', 'feed must be an https URL');
    }
  });
  return { ok: issues.ok, issues: issues.list };
}

/**
 * The key log lists every `key` activity of an island, oldest first.
 * @param {unknown} keyLog
 * @returns {{ ok: boolean, issues: Issue[] }}
 */
export function validateKeyLog(keyLog) {
  const issues = new Issues();
  if (!isPlainObject(keyLog)) {
    issues.add('', 'not-object', 'a key log must be a JSON object');
    return { ok: false, issues: issues.list };
  }
  const ownerOk = checkHeader(keyLog, issues);
  if (!Array.isArray(keyLog.items) || keyLog.items.length > DOCUMENT_LIMITS.keyLogItems) {
    issues.add('items', 'invalid-items', `items must be a list of at most ${DOCUMENT_LIMITS.keyLogItems} key activities`);
    return { ok: false, issues: issues.list };
  }
  let previous = -Infinity;
  const ids = new Set();
  keyLog.items.forEach((/** @type {unknown} */ item, index) => {
    const path = `items/${index}`;
    const result = validateActivity(item);
    for (const issue of result.issues) issues.add(`${path}/${issue.path}`, issue.code, issue.message);
    if (!isPlainObject(item)) return;
    if (ids.has(item.id)) issues.add(`${path}/id`, 'duplicate-id', 'every key activity needs its own id');
    ids.add(item.id);
    if (item.type !== 'key') issues.add(`${path}/type`, 'not-key-activity', 'the key log only holds key activities');
    if (ownerOk && item.actor !== keyLog.owner) issues.add(`${path}/actor`, 'foreign-item', 'key activities must be written by the owner');
    if (isDateTime(item.published)) {
      const time = timeOf(item.published);
      if (time < previous) issues.add(`${path}/published`, 'not-chronological', 'the key log must be oldest first');
      previous = time;
    }
  });
  return { ok: issues.ok, issues: issues.list };
}
