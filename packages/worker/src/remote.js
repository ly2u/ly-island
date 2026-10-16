// What this island knows about others: their last valid manifest and the
// key history used to verify them (protocol "首次信任与密钥历史").
//
// Manifests are read at most once a day per island unless a signature needs
// a key we do not have yet. When a manifest has links.keys, the key log is
// synced on every manifest read, so rotations and revocations are applied
// in log order. Anything that cannot be explained pauses the island until
// the owner confirms.

import {
  compareManifest,
  DOCUMENT_LIMITS,
  pause,
  syncKeyLog,
  trustOnFirstUse,
  validateKeyLog,
  validateManifest,
} from '../../protocol/src/index.js';
import { OutboundError, parseJson } from './net.js';

export const MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
const KEY_LOG_BYTES = 256 * 1024;

/**
 * @typedef {{ status: string, pauseReason?: string, keys: any[], logHead: any, origin: string }} KeyHistory
 * @typedef {{ ok: true, manifest: Record<string, any>, history: KeyHistory, fetched: boolean, paused: boolean }
 *   | { ok: false, reason: string, retry: boolean }} Learned
 */

/** @param {unknown} text */
function parsed(text) {
  if (typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * @param {{ net: ReturnType<typeof import('./net.js').outbound> }} ctx
 * @param {string} origin @param {string} address
 */
async function readKeyLog(ctx, origin, address) {
  const response = await ctx.net.get(address, { sameOriginAs: origin, limit: KEY_LOG_BYTES });
  if (response.status !== 200) return { ok: false, reason: `key-log-${response.status}` };
  const log = parseJson(response.body);
  const check = validateKeyLog(log);
  if (!check.ok || log.owner !== origin) return { ok: false, reason: 'invalid-key-log' };
  return { ok: true, log };
}

/**
 * Brings what we know about `origin` up to date when needed.
 * @param {{ net: ReturnType<typeof import('./net.js').outbound>, now: () => number }} ctx
 * @param {string} origin
 * @param {Record<string, any> | null} row the island's row, if any
 * @param {{ force?: boolean }} [options] force: read the manifest even if the cached one is fresh
 * @returns {Promise<Learned>}
 */
export async function learnIsland(ctx, origin, row, { force = false } = {}) {
  const cachedManifest = parsed(row?.manifest);
  const cachedHistory = parsed(row?.history);
  const fresh = cachedManifest && cachedHistory && Number(row?.manifest_at) > ctx.now() - MANIFEST_TTL_MS;
  if (fresh && !force) {
    return { ok: true, manifest: cachedManifest, history: cachedHistory, fetched: false, paused: cachedHistory.status === 'paused' };
  }

  let response;
  try {
    response = await ctx.net.get(`${origin}/.well-known/island.json`, { sameOriginAs: origin, limit: DOCUMENT_LIMITS.manifestBytes });
  } catch (error) {
    // Only network trouble is worth retrying; refused addresses and redirects stay refused.
    if (error instanceof OutboundError) return { ok: false, reason: error.reason, retry: ['timeout', 'network-error'].includes(error.reason) };
    throw error;
  }
  if (response.status !== 200) return { ok: false, reason: `manifest-${response.status}`, retry: response.status === 429 || response.status >= 500 };
  const manifest = parseJson(response.body);
  if (!validateManifest(manifest, { fetchedOrigin: origin }).ok) return { ok: false, reason: 'invalid-manifest', retry: false };

  const now = new Date(ctx.now()).toISOString();
  const keysAddress = typeof manifest.links?.keys === 'string' ? manifest.links.keys : null;
  let history = cachedHistory;

  if (!history) {
    let keyLog = null;
    if (keysAddress) {
      const read = await readKeyLog(ctx, origin, keysAddress);
      if (!read.ok) return { ok: false, reason: read.reason, retry: true };
      keyLog = read.log;
    }
    history = await trustOnFirstUse(manifest, { now, keyLog });
  } else if (history.status !== 'paused') {
    if (keysAddress) {
      const read = await readKeyLog(ctx, origin, keysAddress);
      if (read.ok) history = (await syncKeyLog(history, read.log)).history;
    }
    const comparison = compareManifest(history, manifest);
    if (comparison.status === 'mismatch') history = pause(history, 'key-mismatch');
    else if (comparison.status === 'needs-sync') history = pause(history, 'unknown-key');
  }
  return { ok: true, manifest, history, fetched: true, paused: history.status === 'paused' };
}

/**
 * The columns to save after learnIsland() read something new.
 * @param {Learned & { ok: true }} learned @param {number} now
 */
export function islandColumns(learned, now) {
  return {
    name: String(learned.manifest.name ?? ''),
    manifest: JSON.stringify(learned.manifest),
    manifest_at: now,
    history: JSON.stringify(learned.history),
  };
}

/**
 * An upsert for an island row. `extra` adds flag columns (0/1) that only go up.
 * @param {string} origin @param {number} now
 * @param {Partial<ReturnType<typeof islandColumns>>} columns
 * @param {{ follower?: number, following?: number }} [flags]
 */
export function upsertIsland(origin, now, columns, flags = {}) {
  return /** @type {[string, unknown[]]} */ ([
    `INSERT INTO islands (origin, name, manifest, manifest_at, history, first_seen, follower, following)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (origin) DO UPDATE SET
       name = COALESCE(excluded.name, islands.name),
       manifest = COALESCE(excluded.manifest, islands.manifest),
       manifest_at = COALESCE(excluded.manifest_at, islands.manifest_at),
       history = COALESCE(excluded.history, islands.history),
       follower = MAX(islands.follower, excluded.follower),
       following = MAX(islands.following, excluded.following)`,
    [
      origin,
      columns.name ?? null,
      columns.manifest ?? null,
      columns.manifest_at ?? null,
      columns.history ?? null,
      now,
      flags.follower ?? 0,
      flags.following ?? 0,
    ],
  ]);
}
