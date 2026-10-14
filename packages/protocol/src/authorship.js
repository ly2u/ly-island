// Who may change what (protocol sections "搬家" and "撤回与修改的归属").
//
// A valid signature only says who sent an activity. These rules decide
// whether that sender may withdraw or replace another activity.

import { effectiveUpdated, isDirectedType } from './activity.js';
import { originOf, timeOf } from './util.js';

const MAX_MIGRATION_HOPS = 8;

/**
 * Migrations are stored as { [oldOrigin]: newOrigin }, recorded only after a
 * move was confirmed from both sides (see confirmMove).
 * @typedef {Record<string, string>} Migrations
 */

/**
 * Both sides of a move must agree: the old island published a verified
 * `move` to the new origin, and the new manifest (read over HTTPS from the
 * new origin) lists the old origin in `alsoKnownAs`.
 * The caller verifies the move's signature with the old island's key history.
 * @param {Record<string, any>} move a verified `move` activity
 * @param {{ id: string, alsoKnownAs?: string[] }} newManifest a validated manifest read from the new origin
 * @returns {{ ok: true, from: string, to: string } | { ok: false, reason: string }}
 */
export function confirmMove(move, newManifest) {
  if (move.type !== 'move') return { ok: false, reason: 'not-a-move' };
  if (move.object.to !== newManifest.id) return { ok: false, reason: 'target-mismatch' };
  if (!(newManifest.alsoKnownAs ?? []).includes(move.actor)) return { ok: false, reason: 'not-acknowledged' };
  return { ok: true, from: move.actor, to: newManifest.id };
}

/**
 * @param {Migrations} migrations
 * @param {string} from
 * @param {string} to
 * @returns {Migrations}
 */
export function recordMigration(migrations, from, to) {
  return { ...migrations, [from]: to };
}

/**
 * True when `candidate` is `origin` or reachable from it through confirmed migrations.
 * @param {Migrations} migrations
 * @param {string} origin
 * @param {string} candidate
 */
export function speaksFor(migrations, origin, candidate) {
  let current = origin;
  const seen = new Set([current]);
  for (let hop = 0; hop <= MAX_MIGRATION_HOPS; hop += 1) {
    if (current === candidate) return true;
    const next = Object.hasOwn(migrations, current) ? migrations[current] : undefined;
    if (next === undefined || seen.has(next)) return false;
    seen.add(next);
    current = next;
  }
  return false;
}

/**
 * Decides whether a verified `delete` takes effect.
 * Only a valid delete may leave a tombstone; anything else is dropped.
 * @param {Record<string, any>} del a `delete` that passed validation and signature checks
 * @param {{ target?: Record<string, any>, migrations?: Migrations }} [context]
 *   target: the stored activity it points at, when the receiver has it
 * @returns {{ ok: true, tombstone: string } | { ok: false, reason: string }}
 */
export function checkDelete(del, { target, migrations = {} } = {}) {
  if (del.type !== 'delete') return { ok: false, reason: 'not-a-delete' };
  const of = del.object?.of;
  const author = originOf(of);
  if (author === null) return { ok: false, reason: 'invalid-target' };
  if (!speaksFor(migrations, author, del.actor)) return { ok: false, reason: 'not-author' };
  if (target !== undefined) {
    if (target.id !== of) return { ok: false, reason: 'target-mismatch' };
    if (target.actor !== author) return { ok: false, reason: 'not-author' };
  }
  return { ok: true, tombstone: tombstoneKey(of) };
}

/**
 * Tombstones are keyed by the withdrawn activity id. The id already carries
 * its author's origin, and only checkDelete() may create one.
 * @param {string} of
 */
export function tombstoneKey(of) {
  return of;
}

/**
 * Whether `incoming` may replace the stored `existing` activity.
 * Public activities can be updated by their author; directed ones never change.
 * @param {Record<string, any>} existing
 * @param {Record<string, any>} incoming
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canReplace(existing, incoming) {
  if (existing.id !== incoming.id) return { ok: false, reason: 'different-id' };
  if (existing.actor !== incoming.actor) return { ok: false, reason: 'not-author' };
  if (isDirectedType(existing.type) || isDirectedType(incoming.type)) return { ok: false, reason: 'immutable' };
  if (existing.type !== incoming.type) return { ok: false, reason: 'type-changed' };
  const before = timeOf(/** @type {string} */ (effectiveUpdated(/** @type {any} */ (existing))));
  const after = timeOf(/** @type {string} */ (effectiveUpdated(/** @type {any} */ (incoming))));
  if (!(after > before)) return { ok: false, reason: 'not-newer' };
  return { ok: true };
}
