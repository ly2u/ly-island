// Reading followed islands (protocol "频率与批次", "动态（outbox）").
//
// - Due islands only: every hour if they posted in the last 7 days, every 6
//   hours within 30 days, otherwise daily; a per-pair offset spreads load.
// - Conditional GETs: most runs see 304.
// - The outbox is a mutable snapshot: when the head's snapshot digest
//   changes (or the publisher has none), the pages behind it are scanned
//   again, one page per island per run, and the head is checked once more
//   when the scan ends. Old ids do not stop the scan.
// - Only activity versions not seen before are verified, at most
//   `verifyLimit` per run; the rest waits for the next run.
// - A first sync records the feed without "neighbor.posted" events.
// - Stops when the run's budget runs low; progress is saved per island.

import {
  checkDelete,
  DOCUMENT_LIMITS,
  effectiveUpdated,
  validateFriends,
  validateOutbox,
  verifyActivity,
} from '../../protocol/src/index.js';
import { OutboundError, parseJson } from './net.js';
import { eventStatement } from './notify.js';
import { islandColumns, learnIsland, upsertIsland } from './remote.js';
import { hash32 } from './util.js';
import { clip } from './strings.js';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
export const POLL = Object.freeze({
  intervals: [
    [7 * DAY, HOUR],
    [30 * DAY, 6 * HOUR],
    [Infinity, DAY],
  ],
  friendsEvery: DAY,
  perIslandRequests: 4,
  verifyLimit: 40,
  reserve: 6,
});

/**
 * @typedef {{ etag: string | null, snapshot: string | null, target: string | null, pending: string | null,
 *   nextAt: number, failures: number, lastActivity: string | null, synced: boolean }} PollState
 */

/** @returns {PollState} */
function freshState() {
  return { etag: null, snapshot: null, target: null, pending: null, nextAt: 0, failures: 0, lastActivity: null, synced: false };
}

/** @param {string} self @param {string} origin @param {string | null} lastActivity @param {number} now */
export function nextPoll(self, origin, lastActivity, now) {
  const age = lastActivity ? now - Date.parse(lastActivity) : Infinity;
  const interval = POLL.intervals.find(([within]) => age <= within)?.[1] ?? DAY;
  const offset = hash32(`${self} ${origin}`) % (15 * 60 * 1000);
  return now + interval + offset;
}

/**
 * @typedef {object} PollContext
 * @property {string} self
 * @property {Set<string>} publicFriends
 * @property {import('./store-d1.js').Store} store
 * @property {ReturnType<typeof import('./net.js').outbound>} net
 * @property {() => number} now
 * @property {ReturnType<typeof import('./budget.js').budget>} budget
 * @property {import('./notify.js').Policy} policy
 * @property {ReturnType<typeof import('./strings.js').stringsFor>} strings
 */

/**
 * One cron run's worth of reading.
 * @param {PollContext} ctx
 * @param {{ force?: boolean }} [options] force: also islands not yet due (the owner's "sync now")
 * @returns {Promise<{ polled: string[], verified: number, events: number }>}
 */
export async function pollNeighbors(ctx, { force = false } = {}) {
  const now = ctx.now();
  const rows = await ctx.store.all('SELECT * FROM islands WHERE following = 1 OR origin IN (SELECT value FROM json_each(?))', [JSON.stringify([...ctx.publicFriends])]);
  const byOrigin = new Map(rows.map((row) => [row.origin, row]));
  for (const origin of ctx.publicFriends) if (!byOrigin.has(origin)) byOrigin.set(origin, null);

  const due = [...byOrigin.entries()]
    .map(([origin, row]) => ({ origin, row, state: { ...freshState(), ...(row?.poll ? JSON.parse(row.poll) : {}) } }))
    .filter(({ row, state }) => !row?.blocked && (force || state.nextAt <= now))
    .sort((a, b) => a.state.nextAt - b.state.nextAt || hash32(`${now} ${a.origin}`) - hash32(`${now} ${b.origin}`));

  const verify = { left: POLL.verifyLimit };
  /** @type {[string, unknown[]][]} */
  const writes = [];
  const polled = [];
  let events = 0;
  for (const item of due) {
    if (!ctx.budget.has(POLL.perIslandRequests + POLL.reserve)) break;
    polled.push(item.origin);
    events += await pollOne(ctx, item, verify, writes);
  }
  if (writes.length > 0) await ctx.store.batch(writes);
  return { polled, verified: POLL.verifyLimit - verify.left, events };
}

/**
 * @param {PollContext} ctx
 * @param {{ origin: string, row: Record<string, any> | null, state: PollState }} item
 * @param {{ left: number }} verify
 * @param {[string, unknown[]][]} writes
 */
async function pollOne(ctx, { origin, row, state }, verify, writes) {
  const now = ctx.now();
  const save = (/** @type {PollState} */ next) =>
    writes.push(upsertIsland(origin, now, {}), ['UPDATE islands SET poll = ? WHERE origin = ?', [JSON.stringify(next), origin]]);
  const failed = (/** @type {number} */ retryAfterSeconds = 0) => {
    const failures = state.failures + 1;
    const backoff = Math.min(DAY, 15 * 60 * 1000 * 2 ** Math.min(failures, 7));
    save({ ...state, failures, nextAt: now + Math.max(backoff, retryAfterSeconds * 1000) });
    return 0;
  };

  const learned = await learnIsland(ctx, origin, row);
  if (!learned.ok) return failed();
  if (learned.fetched) writes.push(upsertIsland(origin, now, islandColumns(learned, now)));
  if (learned.paused) {
    save({ ...state, nextAt: now + DAY });
    return 0;
  }
  const { manifest, history } = learned;
  const name = String(manifest.name ?? origin);
  const known = new Map((await ctx.store.all('SELECT id, version, activity FROM feed WHERE actor = ?', [origin])).map((r) => [r.id, r]));

  // Which page: the head, or the next page of an unfinished scan.
  const scanning = state.pending !== null;
  const address = scanning ? state.pending : manifest.links.outbox;
  let response;
  try {
    response = await ctx.net.get(String(address), {
      sameOriginAs: origin,
      etag: scanning ? null : state.etag,
      limit: DOCUMENT_LIMITS.outboxBytes,
    });
  } catch (error) {
    if (error instanceof OutboundError) return failed();
    throw error;
  }
  if (response.status === 304 && !scanning) {
    save({ ...state, failures: 0, nextAt: nextPoll(ctx.self, origin, state.lastActivity, now) });
    return 0;
  }
  if (response.status === 429 || response.status >= 500) return failed(response.retryAfter ?? 0);
  if (response.status !== 200) return failed();
  const page = parseJson(response.body);
  const check = validateOutbox(page);
  if (!check.ok || page.owner !== origin) return failed();

  let events = 0;
  let complete = true;
  let lastActivity = state.lastActivity;
  for (const [index, activity] of page.items.entries()) {
    if (!check.items[index]?.ok || activity.actor !== origin) continue;
    const version = `${effectiveUpdated(activity)} ${activity.proof.value}`;
    if (activity.type === 'post' || activity.type === 'delete') {
      if (known.get(activity.id)?.version === version) continue;
      if (activity.type === 'delete' && !known.has(activity.object.of)) continue;
      if (verify.left <= 0) {
        complete = false;
        break;
      }
      verify.left -= 1;
      const verdict = await verifyActivity(history, activity, { source: 'origin', delivery: false });
      if (!verdict.ok) continue;
      if (!lastActivity || effectiveUpdated(activity) > lastActivity) lastActivity = effectiveUpdated(activity);
      if (activity.type === 'delete') {
        const target = JSON.parse(known.get(activity.object.of)?.activity ?? 'null');
        if (checkDelete(activity, { target }).ok) {
          writes.push(['DELETE FROM feed WHERE actor = ? AND id = ?', [origin, activity.object.of]]);
          known.delete(activity.object.of);
        }
        continue;
      }
      const previous = known.get(activity.id);
      if (previous && JSON.parse(previous.activity).actor === origin && effectiveUpdated(JSON.parse(previous.activity)) >= effectiveUpdated(activity)) continue;
      writes.push([
        'INSERT INTO feed (actor, id, version, published, activity) VALUES (?, ?, ?, ?, ?) ON CONFLICT (actor, id) DO UPDATE SET version = excluded.version, published = excluded.published, activity = excluded.activity',
        [origin, activity.id, version, activity.published, JSON.stringify(activity)],
      ]);
      known.set(activity.id, { id: activity.id, version, activity: JSON.stringify(activity) });
      if (!previous && state.synced) {
        const title = activity.object.title ?? activity.object.summary ?? activity.object.url;
        const event = eventStatement(ctx.policy, {
          type: 'neighbor.posted',
          at: now,
          actor: { id: origin, name },
          summary: ctx.strings.posted(name, clip(title, 60)),
          url: activity.object.url,
        });
        if (event) {
          writes.push(event);
          events += 1;
        }
      }
    } else if (activity.type === 'key') {
      // A hint that the key log changed: read the manifest and log next time.
      writes.push(['UPDATE islands SET manifest_at = 0 WHERE origin = ?', [origin]]);
    }
    // Bottles and moves come with phase 3.
  }

  /** @type {PollState} */
  const next = { ...state, failures: 0, lastActivity };
  if (!complete) {
    // Out of verifications: read the same page again next run.
    if (!scanning) next.etag = null;
    next.nextAt = now;
  } else if (!scanning) {
    next.etag = response.etag;
    const changed = page.snapshot === undefined || page.snapshot !== state.snapshot || !state.synced;
    if (changed && page.next) {
      next.pending = page.next;
      next.target = page.snapshot ?? null;
      next.nextAt = now;
    } else {
      next.snapshot = page.snapshot ?? null;
      next.synced = true;
      next.nextAt = nextPoll(ctx.self, origin, lastActivity, now);
    }
  } else if (page.next) {
    next.pending = page.next;
    next.nextAt = now;
  } else {
    // Scan finished: check the head once more before calling it complete.
    next.pending = null;
    next.snapshot = state.target;
    next.etag = null;
    next.synced = true;
    next.nextAt = now;
  }
  save(next);

  // Who they follow, once a day: for "friend of a friend", and whether they follow us.
  const friendsAt = Number(row?.friends_at ?? 0);
  if (typeof manifest.links.friends === 'string' && now - friendsAt >= POLL.friendsEvery && ctx.budget.has(POLL.reserve + 1)) {
    try {
      const friends = await ctx.net.get(manifest.links.friends, { sameOriginAs: origin, limit: 512 * 1024 });
      if (friends.status === 200) {
        const doc = parseJson(friends.body);
        if (validateFriends(doc).ok && doc.owner === origin) {
          const list = doc.items.map((/** @type {{ id: string }} */ entry) => entry.id);
          writes.push([
            'UPDATE islands SET friends = ?, friends_at = ?, follower = MAX(follower, ?) WHERE origin = ?',
            [JSON.stringify(list), now, list.includes(ctx.self) ? 1 : 0, origin],
          ]);
        }
      }
    } catch (error) {
      if (!(error instanceof OutboundError)) throw error;
    }
  }
  return events;
}
