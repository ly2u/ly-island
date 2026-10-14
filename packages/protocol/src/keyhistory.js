// Key history (protocol section "首次信任与密钥历史").
//
// A receiver keeps one history per island and verifies signatures only
// against it, never against whatever keys the current manifest lists.
//
// - First contact trusts the manifest keys and anchors the island's key log
//   (if it has one): the id and position of its newest entry, plus a running
//   digest of every entry up to it.
// - Key changes are applied only from the key log, strictly in log order,
//   starting after the anchored head. A `key` activity seen in an outbox is
//   just a hint to sync the log.
// - The log is append-only. If anything up to the head changed (an entry
//   removed, reordered, or rewritten under the same id), the history pauses.
// - Any entry that cannot be verified, or a valid signature from a key that
//   is already revoked, pauses the history until the owner confirms.
//
// Histories are plain JSON so they can be stored as they are.

import { decode, encode } from './base64url.js';
import { canonicalBytes } from './canonicalize.js';
import { verifySignature } from './sign.js';
import { isPlainObject, timeOf } from './util.js';

/**
 * @typedef {{
 *   id: string,
 *   publicKey: string,
 *   trustedAt: string,
 *   revokedAt?: string,
 *   reason?: 'retired' | 'compromised',
 * }} KeyRecord
 *
 * @typedef {{
 *   id: string,
 *   index: number,
 *   digest: string,
 * }} LogHead
 *   id and position of the newest entry applied or anchored, and the running
 *   digest of entries 0..index (see chainDigest).
 *
 * @typedef {{
 *   origin: string,
 *   status: 'trusted' | 'paused',
 *   pauseReason?: string,
 *   keys: KeyRecord[],
 *   logHead: LogHead | null,
 * }} KeyHistory
 */

/**
 * Running digest over log entries: d(-1) is empty, and
 * d(i) = SHA-256(d(i-1) || canonical bytes of entry i, proof included).
 * @param {Uint8Array} previous
 * @param {unknown} entry
 */
async function step(previous, entry) {
  const bytes = canonicalBytes(entry);
  const input = new Uint8Array(previous.length + bytes.length);
  input.set(previous);
  input.set(bytes, previous.length);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', input));
}

/**
 * The running digest of entries 0..last of a key log, base64url encoded.
 * @param {unknown[]} items
 * @param {number} last
 */
export async function chainDigest(items, last) {
  let digest = new Uint8Array(0);
  for (let i = 0; i <= last; i += 1) digest = await step(digest, items[i]);
  return encode(digest);
}

/** @param {{ items: Record<string, any>[] }} keyLog */
function hasDuplicateIds(keyLog) {
  const ids = keyLog.items.map((item) => item?.id);
  return new Set(ids).size !== ids.length;
}

/** @param {KeyHistory} history @returns {KeyHistory} */
function copy(history) {
  return structuredClone(history);
}

/** @param {KeyHistory} history @param {string} reason @returns {KeyHistory} */
function paused(history, reason) {
  return { ...copy(history), status: 'paused', pauseReason: reason };
}

/**
 * First contact. `manifest` must already pass validateManifest().
 * When the manifest has `links.keys`, read the key log first and pass it,
 * so later syncs can tell appended entries from rewritten ones.
 * @param {{ id: string, keys: { id: string, publicKey: string }[] }} manifest
 * @param {{ now: string, keyLog?: { owner: string, items: Record<string, any>[] } | null }} context
 *   keyLog: the island's key log as read now (must pass validateKeyLog), or null
 * @returns {Promise<KeyHistory>}
 */
export async function trustOnFirstUse(manifest, { now, keyLog = null }) {
  /** @type {KeyHistory} */
  const history = {
    origin: manifest.id,
    status: 'trusted',
    keys: manifest.keys.map((key) => ({ id: key.id, publicKey: key.publicKey, trustedAt: now })),
    logHead: null,
  };
  if (keyLog === null || keyLog.items.length === 0) return history;
  if (keyLog.owner !== manifest.id || hasDuplicateIds(keyLog)) return paused(history, 'invalid-key-log');
  const last = keyLog.items.length - 1;
  history.logHead = { id: keyLog.items[last].id, index: last, digest: await chainDigest(keyLog.items, last) };
  return history;
}

/**
 * Starts over after the owner confirmed a key change by hand.
 * Old keys are dropped; activities signed by them can no longer be verified.
 * @param {{ id: string, keys: { id: string, publicKey: string }[] }} manifest
 * @param {{ now: string, keyLog?: { owner: string, items: Record<string, any>[] } | null }} context
 */
export function retrust(manifest, context) {
  return trustOnFirstUse(manifest, context);
}

/**
 * Compares a freshly read manifest with the history.
 * @param {KeyHistory} history
 * @param {{ id: string, keys: { id: string, publicKey: string }[] }} manifest
 * @returns {{ status: 'consistent' | 'needs-sync' | 'mismatch', unknown: string[] }}
 *   needs-sync: the manifest lists keys the history does not know yet; sync the
 *   key log, and if they are still unknown, pause with reason "unknown-key".
 */
export function compareManifest(history, manifest) {
  /** @type {string[]} */
  const unknown = [];
  for (const key of manifest.keys) {
    const known = history.keys.find((record) => record.id === key.id);
    if (!known) unknown.push(key.id);
    else if (known.publicKey !== key.publicKey) return { status: 'mismatch', unknown: [] };
  }
  return { status: unknown.length > 0 ? 'needs-sync' : 'consistent', unknown };
}

/**
 * Marks the history paused, for example when the manifest lists a key that
 * the key log cannot explain.
 * @param {KeyHistory} history
 * @param {string} reason
 */
export function pause(history, reason) {
  return paused(history, reason);
}

/**
 * Applies the entries of a key log that come after the anchored head.
 * `keyLog` must already pass validateKeyLog().
 * @param {KeyHistory} history
 * @param {{ owner: string, items: Record<string, any>[] }} keyLog
 * @returns {Promise<{ history: KeyHistory, outcome: 'up-to-date' | 'applied' | 'paused', applied: number, reason?: string }>}
 */
export async function syncKeyLog(history, keyLog) {
  /** @param {string} reason */
  const stop = (reason) => ({ history: paused(history, reason), outcome: /** @type {'paused'} */ ('paused'), applied: 0, reason });

  if (history.status === 'paused') {
    return { history, outcome: 'paused', applied: 0, reason: history.pauseReason };
  }
  if (keyLog.owner !== history.origin) return stop('foreign-key-log');
  // Ids locate the head, so they must be unique. Checked before anything changes.
  if (hasDuplicateIds(keyLog)) return stop('invalid-key-log');

  let start = 0;
  let digest = new Uint8Array(0);
  if (history.logHead !== null) {
    const { id, index, digest: expected } = history.logHead;
    if (keyLog.items[index]?.id !== id) return stop('log-rewritten');
    let observed;
    try {
      observed = await chainDigest(keyLog.items, index);
    } catch {
      return stop('invalid-key-log');
    }
    if (observed !== expected) return stop('log-rewritten');
    digest = decode(expected);
    start = index + 1;
  }
  if (start >= keyLog.items.length) return { history, outcome: 'up-to-date', applied: 0 };

  let next = copy(history);
  let applied = 0;
  for (let i = start; i < keyLog.items.length; i += 1) {
    const entry = keyLog.items[i];
    const result = await applyEntry(next, entry);
    if (result.reason !== undefined) {
      return { history: paused(next, result.reason), outcome: 'paused', applied, reason: result.reason };
    }
    next = result.history;
    digest = await step(digest, entry);
    next.logHead = { id: entry.id, index: i, digest: encode(digest) };
    applied += 1;
  }
  return { history: next, outcome: 'applied', applied };
}

/**
 * @param {KeyHistory} history a private copy that may be changed
 * @param {Record<string, any>} entry
 * @returns {Promise<{ history: KeyHistory, reason?: string }>}
 */
async function applyEntry(history, entry) {
  if (!isPlainObject(entry) || entry.type !== 'key' || entry.actor !== history.origin || !isPlainObject(entry.object)) {
    return { history, reason: 'chain-broken' };
  }

  const signer = history.keys.find((record) => record.id === entry.proof?.key);
  if (!signer) return { history, reason: 'chain-broken' };
  if (!(await verifySignature(entry, decode(signer.publicKey)))) return { history, reason: 'chain-broken' };

  // The log only grows. A valid signature from a key that an earlier entry
  // already revoked means someone else still holds that key.
  if (signer.revokedAt !== undefined) return { history, reason: 'fork' };

  const { add, revoke, reason = 'retired' } = entry.object;
  if (add !== undefined) {
    const sameId = history.keys.find((record) => record.id === add.id);
    const samePublicKey = history.keys.find((record) => record.publicKey === add.publicKey);
    if (sameId && sameId.publicKey !== add.publicKey) return { history, reason: 'key-mismatch' };
    if (!sameId && samePublicKey) return { history, reason: 'key-mismatch' };
    if (!sameId) history.keys.push({ id: add.id, publicKey: add.publicKey, trustedAt: entry.published });
  }
  if (revoke !== undefined) {
    const target = history.keys.find((record) => record.id === revoke);
    if (target) {
      if (target.revokedAt === undefined) {
        target.revokedAt = entry.published;
        target.reason = reason;
      } else if (reason === 'compromised') {
        target.reason = 'compromised';
      }
    }
  }
  return { history };
}

/**
 * Which public key may verify an activity signed with `keyId`.
 * @param {KeyHistory} history
 * @param {string} keyId
 * @param {{ published: string, source: 'origin' | 'relay', delivery: boolean }} context
 *   source: "origin" when read over HTTPS from the actor's own origin,
 *   "relay" when it came through a lighthouse or another island.
 *   delivery: true for activities posted to an inbox.
 * @returns {{ ok: true, publicKey: Uint8Array } | { ok: false, reason: string }}
 */
export function resolveKey(history, keyId, { published, source, delivery }) {
  if (history.status === 'paused') return { ok: false, reason: 'paused' };
  const record = history.keys.find((key) => key.id === keyId);
  if (!record) return { ok: false, reason: 'unknown-key' };
  if (record.reason === 'compromised') return { ok: false, reason: 'compromised-key' };
  if (record.revokedAt !== undefined) {
    if (delivery || source !== 'origin' || timeOf(published) >= timeOf(record.revokedAt)) {
      return { ok: false, reason: 'revoked-key' };
    }
  }
  return { ok: true, publicKey: decode(record.publicKey) };
}

/**
 * Resolves the key and checks the signature in one step.
 * @param {KeyHistory} history
 * @param {Record<string, any>} activity an activity that passes validateActivity()
 * @param {{ source: 'origin' | 'relay', delivery: boolean }} context
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function verifyActivity(history, activity, { source, delivery }) {
  if (activity.actor !== history.origin) return { ok: false, reason: 'wrong-history' };
  if (typeof activity.proof?.key !== 'string' || typeof activity.published !== 'string') {
    return { ok: false, reason: 'invalid-proof' };
  }
  const key = resolveKey(history, activity.proof.key, { published: activity.published, source, delivery });
  if (!key.ok) return { ok: false, reason: key.reason };
  return (await verifySignature(activity, key.publicKey)) ? { ok: true } : { ok: false, reason: 'bad-signature' };
}
