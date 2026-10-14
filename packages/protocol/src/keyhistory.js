// Key history (protocol section "首次信任与密钥历史").
//
// A receiver keeps one history per island and verifies signatures only
// against it, never against whatever keys the current manifest lists.
//
// - First contact trusts the manifest keys and remembers the head of the
//   island's key log (if it has one).
// - Key changes are applied only from the key log, strictly in log order,
//   starting after the remembered head. A `key` activity seen in an outbox is
//   just a hint to sync the log.
// - Any entry that cannot be verified, or a valid signature from a key that
//   is already revoked, pauses the history until the owner confirms.
//
// Histories are plain JSON so they can be stored as they are.

import { decode } from './base64url.js';
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
 *   origin: string,
 *   status: 'trusted' | 'paused',
 *   pauseReason?: string,
 *   keys: KeyRecord[],
 *   logHead: string | null,
 * }} KeyHistory
 */

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
 * @param {{ id: string, keys: { id: string, publicKey: string }[] }} manifest
 * @param {{ now: string, keyLogHead?: string | null }} context
 *   keyLogHead: id of the newest entry of the island's key log at this moment,
 *   or null when the island has no key log yet.
 * @returns {KeyHistory}
 */
export function trustOnFirstUse(manifest, { now, keyLogHead = null }) {
  return {
    origin: manifest.id,
    status: 'trusted',
    keys: manifest.keys.map((key) => ({ id: key.id, publicKey: key.publicKey, trustedAt: now })),
    logHead: keyLogHead,
  };
}

/**
 * Starts over after the owner confirmed a key change by hand.
 * Old keys are dropped; activities signed by them can no longer be verified.
 * @param {{ id: string, keys: { id: string, publicKey: string }[] }} manifest
 * @param {{ now: string, keyLogHead?: string | null }} context
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
 * Applies the entries of a key log that come after the remembered head.
 * `keyLog` must already pass validateKeyLog().
 * @param {KeyHistory} history
 * @param {{ owner: string, items: Record<string, any>[] }} keyLog
 * @returns {Promise<{ history: KeyHistory, outcome: 'up-to-date' | 'applied' | 'paused', applied: number, reason?: string }>}
 */
export async function syncKeyLog(history, keyLog) {
  if (history.status === 'paused') {
    return { history, outcome: 'paused', applied: 0, reason: history.pauseReason };
  }
  if (keyLog.owner !== history.origin) {
    return { history: paused(history, 'foreign-key-log'), outcome: 'paused', applied: 0, reason: 'foreign-key-log' };
  }

  let start = 0;
  if (history.logHead !== null) {
    const index = keyLog.items.findIndex((item) => item.id === history.logHead);
    if (index < 0) {
      return { history: paused(history, 'log-rewritten'), outcome: 'paused', applied: 0, reason: 'log-rewritten' };
    }
    start = index + 1;
  }
  if (start >= keyLog.items.length) return { history, outcome: 'up-to-date', applied: 0 };

  let next = copy(history);
  let applied = 0;
  for (const entry of keyLog.items.slice(start)) {
    const result = await applyEntry(next, entry);
    if (result.reason !== undefined) {
      return { history: paused(next, result.reason), outcome: 'paused', applied, reason: result.reason };
    }
    next = result.history;
    next.logHead = entry.id;
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
