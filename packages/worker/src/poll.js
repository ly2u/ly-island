// Reading followed islands (protocol "频率与批次", "动态（outbox）").
//
// - Due islands only: every hour if they posted in the last 7 days, every 6
//   hours within 30 days, otherwise daily; a per-pair offset spreads load.
// - Conditional GETs: most runs see a 304 for the head page and stop there.
// - The outbox is a mutable snapshot. When the head shows a new snapshot
//   digest (or the publisher has none), the whole chain of pages is scanned
//   again, one page per island per run, each with its own ETag; a 304 page
//   is taken from the page cache. When the chain ends, the digest of all
//   items is computed and must equal the head's snapshot; then, on the next
//   run, the head is checked once more and must still show that snapshot.
//   Only then is the scan complete. A mismatch starts over; repeated
//   mismatches back off like any failure. Loops and over-long chains fail.
// - Only activity versions not seen before are verified, at most
//   `verifyLimit` per run; the rest waits for the next run.
// - Valid withdrawals leave a tombstone (src/schema.js): an old signed copy
//   of the post cannot bring it back, only a later version can.
// - The first complete sync records the feed without "neighbor.posted".
// - Budget: the batch that saves the run and a reserve for notifications are
//   held from the start. When the budget runs out inside an island, that
//   island's unfinished work is dropped (it is first in line next run) and
//   everything finished before it is saved.

import {
  canonicalize,
  checkDelete,
  DOCUMENT_LIMITS,
  effectiveUpdated,
  validateFriends,
  validateOutbox,
  verifyActivity,
} from '../../protocol/src/index.js';
import { BudgetExceeded } from './budget.js';
import { httpReason, OutboundError, parseJson } from './net.js';
import { timeOf } from '../../protocol/src/util.js';
import { eventStatement } from './notify.js';
import { islandColumns, learnIsland, pausedEvent, upsertIsland } from './remote.js';
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
  verifyLimit: 40,
  /** Left for notifications after polling. */
  reserve: 6,
  /** A longer chain of pages is treated as a loop. */
  maxPages: 200,
  /** Publishers without a snapshot digest are scanned in full this often. */
  fullScanEvery: 7 * DAY,
  /** Snapshot mismatches in a row before backing off. */
  mismatchRetries: 3,
});

/**
 * @typedef {{ target: string | null, headEtag: string | null, visited: string[], pending: string | null, recheck: boolean,
 *   historyTag: string }} Scan  historyTag: the key history the scan verifies against
 * @typedef {{ etag: string | null, snapshot: string | null, synced: boolean, baseline: boolean, scan: Scan | null,
 *   historyTag: string | null, nextAt: number, failures: number, lastActivity: string | null, fullAt: number,
 *   problem: string | null }} PollState  historyTag: the key history the last complete sync verified against
 */

/** @returns {PollState} */
function freshState() {
  return { etag: null, snapshot: null, synced: false, baseline: false, scan: null, historyTag: null, nextAt: 0, failures: 0, lastActivity: null, fullAt: 0, problem: null };
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
 * @returns {Promise<{ polled: string[], verified: number, events: number, stopped: boolean }>}
 */
export async function pollNeighbors(ctx, { force = false } = {}) {
  const now = ctx.now();
  /** @type {string[]} */
  const polled = [];
  if (!ctx.budget.has(POLL.reserve + 3)) return { polled, verified: 0, events: 0, stopped: true };
  // Held from the start: the batch that saves this run, and the notifications after it.
  const release = ctx.budget.hold(POLL.reserve + 1);
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
  let events = 0;
  let stopped = false;
  for (const item of due) {
    if (!ctx.budget.has(1)) {
      stopped = true;
      break;
    }
    /** Writes that stand on their own (a manifest read in full), saved even if the island is cut short. */
    const keep = /** @type {[string, unknown[]][]} */ ([]);
    const island = /** @type {[string, unknown[]][]} */ ([]);
    try {
      events += await pollOne(ctx, item, verify, island, keep);
      writes.push(...keep, ...island);
      polled.push(item.origin);
    } catch (error) {
      if (!(error instanceof BudgetExceeded)) throw error;
      // Out of budget inside this island: its poll state is unchanged, so it
      // comes first next run. Everything before it is saved below.
      writes.push(...keep);
      stopped = true;
      break;
    }
  }
  release();
  if (writes.length > 0) await ctx.store.batch(writes);
  return { polled, verified: POLL.verifyLimit - verify.left, events, stopped };
}

/** SHA-256 of bytes, as 64 lowercase hex characters. @param {Uint8Array} bytes */
async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * The snapshot digest of a set of items given as [id, canonical JSON] pairs:
 * all items sorted by id, as one canonical JSON array (protocol "动态（outbox）").
 * @param {[string, string][]} entries
 */
export async function snapshotOf(entries) {
  const sorted = [...entries].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return sha256Hex(new TextEncoder().encode(`[${sorted.map(([, text]) => text).join(',')}]`));
}

/**
 * @param {PollContext} ctx
 * @param {{ origin: string, row: Record<string, any> | null, state: PollState }} item
 * @param {{ left: number }} verify
 * @param {[string, unknown[]][]} writes this island's writes, saved when it finishes
 * @param {[string, unknown[]][]} keep writes saved even when the budget runs out midway
 */
async function pollOne(ctx, { origin, row, state }, verify, writes, keep) {
  const now = ctx.now();
  const save = (/** @type {PollState} */ next) =>
    writes.push(upsertIsland(origin, now, {}), ['UPDATE islands SET poll = ? WHERE origin = ?', [JSON.stringify(next), origin]]);
  /** @param {string} problem @param {Partial<PollState>} [changes] @param {number} [retryAfterSeconds] */
  const failed = (problem, changes = {}, retryAfterSeconds = 0) => {
    const failures = state.failures + 1;
    const backoff = Math.min(DAY, 15 * 60 * 1000 * 2 ** Math.min(failures, 7));
    save({ ...state, ...changes, failures, problem, nextAt: now + Math.max(backoff, retryAfterSeconds * 1000) });
    return 0;
  };

  const learned = await learnIsland(ctx, origin, row);
  if (!learned.ok) return failed(learned.detail ?? learned.reason);
  if (learned.fetched) {
    keep.push(upsertIsland(origin, now, islandColumns(learned, now)));
    const keyEvent = pausedEvent(ctx, origin, row, learned, now);
    if (keyEvent) keep.push(keyEvent);
  }
  if (learned.paused) {
    save({ ...state, nextAt: now + DAY });
    return 0;
  }
  const { manifest, history } = learned;
  const name = String(manifest.name ?? origin);
  const head = String(manifest.links.outbox);

  // Rejections are remembered per key history: when it changes, items are checked again.
  const historyTag = (await sha256Hex(new TextEncoder().encode(canonicalize(history.keys ?? [])))).slice(0, 32);

  /**
   * Feed versions, tombstones and remembered rejections of this island, and
   * the cached page at `url`.
   * @param {string | null} url
   */
  const readKnown = async (url) => {
    const [feedRows, tombRows, rejectedRows, pageRows] = await ctx.store.batch([
      ['SELECT id, version, activity FROM feed WHERE actor = ?', [origin]],
      ['SELECT target, deleted, version FROM tombstones WHERE actor = ?', [origin]],
      ['SELECT item FROM rejected WHERE actor = ? AND history = ?', [origin, historyTag]],
      ['SELECT url, etag, next, items FROM pages WHERE actor = ? AND url = ?', [origin, url ?? '']],
    ]);
    return {
      feed: new Map(feedRows.map((r) => [String(r.id), { version: String(r.version), at: timeOf(String(r.version).split(' ')[0]), activity: String(r.activity) }])),
      tombs: new Map(tombRows.map((r) => [String(r.target), { deleted: Number(r.deleted), version: String(r.version) }])),
      rejected: new Set(rejectedRows.map((r) => String(r.item))),
      page: pageRows[0] ?? null,
    };
  };

  /** @param {string} address @param {string | null} etag */
  const fetchPage = async (address, etag) => {
    try {
      return await ctx.net.get(address, { sameOriginAs: origin, etag, limit: DOCUMENT_LIMITS.outboxBytes });
    } catch (error) {
      if (error instanceof OutboundError) return { status: 0, error: error.message, body: new Uint8Array(0), etag: null, retryAfter: null, cloudflare: null };
      throw error;
    }
  };
  /** @param {any} response */
  const httpProblem = (response) => (response.status === 0 ? response.error : httpReason(response));
  /** A parsed, valid page of this island, or null. @param {Uint8Array} body */
  const pageFrom = (body) => {
    const page = parseJson(body);
    const check = validateOutbox(page);
    return check.ok && page.owner === origin ? { page, check } : null;
  };

  let scan = state.scan;
  // What was checked against another key history (a key added by the log, a
  // retrust) is read again, whatever the head says: items rejected then may
  // verify now, even if the outbox itself did not change. Unchanged pages
  // come from the page cache.
  const checkedWith = scan ? scan.historyTag : state.synced ? state.historyTag : historyTag;
  const historyChanged = checkedWith !== historyTag;
  if (historyChanged) scan = null;
  /** @type {{ url: string, items: any[], itemOk: boolean[], next: string | null, etag: string | null, fresh: boolean, entries?: [string, string][] }} */
  let current;
  let known;

  if (!scan || scan.recheck) {
    // The head: either the regular conditional check, or the check after a scan.
    const fullDue = state.snapshot === null && now - state.fullAt >= POLL.fullScanEvery;
    const etag = scan ? scan.headEtag : state.synced && !fullDue && !historyChanged ? state.etag : null;
    const response = await fetchPage(head, etag);
    if (response.status === 304 && etag !== null) {
      if (!scan) {
        save({ ...state, failures: 0, problem: null, nextAt: nextPoll(ctx.self, origin, state.lastActivity, now) });
        return 0;
      }
      return complete(scan, scan.headEtag);
    }
    if (response.status !== 200) return failed(httpProblem(response), {}, response.retryAfter ?? 0);
    const read = pageFrom(response.body);
    if (!read) return failed('invalid-outbox');
    const snapshot = read.page.snapshot ?? null;
    if (scan && snapshot !== null && snapshot === scan.target) return complete(scan, response.etag);
    if (!scan && !historyChanged && snapshot !== null && state.synced && snapshot === state.snapshot) {
      // Same content under a new ETag.
      save({ ...state, etag: response.etag, failures: 0, problem: null, nextAt: nextPoll(ctx.self, origin, state.lastActivity, now) });
      return 0;
    }
    // Something changed: scan the chain, starting with this head page.
    scan = { target: snapshot, headEtag: response.etag, visited: [], pending: head, recheck: false, historyTag };
    current = { url: head, items: read.page.items, itemOk: read.check.items.map((i) => i.ok), next: read.page.next ?? null, etag: response.etag, fresh: true };
    known = await readKnown(null);
  } else {
    // The next page of an unfinished scan, with its own ETag. A 304 for the
    // head does not end a scan: it is not even asked here.
    const address = /** @type {string} */ (scan.pending);
    if (scan.visited.includes(address) || scan.visited.length >= POLL.maxPages) return failed('page-loop', { scan: null, etag: null });
    known = await readKnown(address);
    const cached = known.page;
    const response = await fetchPage(address, cached?.etag ?? null);
    if (response.status === 304 && cached) {
      const entries = /** @type {[string, string][]} */ (JSON.parse(String(cached.items)));
      const items = entries.map(([, text]) => JSON.parse(text));
      const check = validateOutbox({ protocol: 'islands/0', id: address, owner: origin, updated: '1970-01-01T00:00:00Z', items });
      current = { url: address, items, itemOk: check.items.map((i) => i.ok), next: cached.next ?? null, etag: cached.etag ?? null, fresh: false, entries };
    } else if (response.status === 200) {
      const read = pageFrom(response.body);
      if (!read) return failed('invalid-outbox', { scan: null, etag: null });
      current = { url: address, items: read.page.items, itemOk: read.check.items.map((i) => i.ok), next: read.page.next ?? null, etag: response.etag, fresh: true };
    } else {
      return failed(httpProblem(response), {}, response.retryAfter ?? 0);
    }
  }

  // The page's items, as canonical JSON for the cache and the digest.
  /** @type {[string, string][]} */
  let entries;
  try {
    entries = current.entries ?? current.items.map((item) => [String(item?.id ?? ''), canonicalize(item)]);
  } catch {
    return failed('invalid-outbox', { scan: null, etag: null });
  }
  if (current.fresh) {
    writes.push([
      'INSERT INTO pages (actor, url, etag, next, items, fetched) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (actor, url) DO UPDATE SET etag = excluded.etag, next = excluded.next, items = excluded.items, fetched = excluded.fetched',
      [origin, current.url, current.etag, current.next, JSON.stringify(entries), now],
    ]);
  }

  const processed = await processItems(ctx, { origin, name, history, historyTag, baseline: state.baseline, now }, { ...current, entries }, known, verify, writes);
  const lastActivity = processed.lastActivity && (!state.lastActivity || timeOf(processed.lastActivity) > timeOf(state.lastActivity)) ? processed.lastActivity : state.lastActivity;
  if (!processed.complete) {
    // Out of verifications: the same page again next run (from the cache if unchanged).
    save({ ...state, scan: { ...scan, pending: current.url }, lastActivity, nextAt: now });
    return processed.events;
  }

  const visited = [...scan.visited, current.url];
  if (current.next !== null) {
    save({ ...state, scan: { ...scan, visited, pending: current.next }, lastActivity, nextAt: now });
    await readFriends(ctx, origin, manifest, row, now, writes);
    return processed.events;
  }

  // The chain ended.
  if (scan.target === null) {
    // No digest to check against (a publisher without the extension).
    save({ ...state, scan: null, snapshot: null, synced: true, baseline: true, etag: scan.headEtag, historyTag: scan.historyTag, fullAt: now, lastActivity, failures: 0, problem: null, nextAt: nextPoll(ctx.self, origin, lastActivity, now) });
    writes.push(['DELETE FROM pages WHERE actor = ? AND url NOT IN (SELECT value FROM json_each(?))', [origin, JSON.stringify(visited)]]);
    await readFriends(ctx, origin, manifest, row, now, writes);
    return processed.events;
  }
  /** @type {[string, string][]} */
  let all = entries;
  if (visited.length > 1) {
    const cachedPages = await ctx.store.all('SELECT url, items FROM pages WHERE actor = ? AND url IN (SELECT value FROM json_each(?))', [origin, JSON.stringify(visited.slice(0, -1))]);
    if (cachedPages.length !== visited.length - 1) return mismatch(lastActivity);
    all = [...entries, ...cachedPages.flatMap((page) => /** @type {[string, string][]} */ (JSON.parse(String(page.items))))];
  }
  if ((await snapshotOf(all)) !== scan.target) return mismatch(lastActivity);
  // Every page adds up to the head's snapshot. Next run checks the head once more.
  // Failures and the last problem stay until the scan is complete, so repeated mismatches back off.
  save({ ...state, scan: { ...scan, visited, pending: null, recheck: true }, baseline: true, lastActivity, nextAt: now });
  await readFriends(ctx, origin, manifest, row, now, writes);
  return processed.events;

  /** The pages read do not add up to the snapshot: mixed versions or a missing item. @param {string | null} last */
  function mismatch(last) {
    const failures = state.failures + 1;
    const again = failures < POLL.mismatchRetries ? now : now + Math.min(DAY, 15 * 60 * 1000 * 2 ** Math.min(failures, 7));
    save({ ...state, scan: null, etag: null, lastActivity: last, failures, problem: 'snapshot-mismatch', nextAt: again });
    return processed.events;
  }

  /** The head still shows the scanned snapshot: the scan is complete. @param {Scan} done @param {string | null} etag */
  function complete(done, etag) {
    save({ ...state, scan: null, snapshot: done.target, synced: true, baseline: true, etag, historyTag: done.historyTag, failures: 0, problem: null, nextAt: nextPoll(ctx.self, origin, state.lastActivity, now) });
    writes.push(['DELETE FROM pages WHERE actor = ? AND url NOT IN (SELECT value FROM json_each(?))', [origin, JSON.stringify(done.visited)]]);
    return 0;
  }
}

/**
 * Verifies and stores what is new on one page. Times are compared as
 * instants (timeOf), never as RFC 3339 text: "+02:00" and "Z" sort wrongly as
 * strings. The activities themselves are stored exactly as signed.
 * @param {PollContext} ctx
 * @param {{ origin: string, name: string, history: any, historyTag: string, baseline: boolean, now: number }} island
 * @param {{ items: any[], itemOk: boolean[], entries: [string, string][] }} page
 * @param {{ feed: Map<string, { version: string, at: number, activity: string }>, tombs: Map<string, { deleted: number, version: string }>, rejected: Set<string> }} known
 * @param {{ left: number }} verify
 * @param {[string, unknown[]][]} writes
 */
async function processItems(ctx, { origin, name, history, historyTag, baseline, now }, page, known, verify, writes) {
  let events = 0;
  /** @type {string | null} */
  let lastActivity = null;
  let pruned = false;
  /**
   * Verifies one item, remembering a failure so later runs skip it.
   * @returns {Promise<'ok' | 'invalid' | 'later'>}
   */
  const check = async (/** @type {any} */ activity, /** @type {number} */ index) => {
    const itemHash = await sha256Hex(new TextEncoder().encode(page.entries[index][1]));
    if (known.rejected.has(itemHash)) return 'invalid';
    if (verify.left <= 0) return 'later';
    verify.left -= 1;
    const verdict = await verifyActivity(history, activity, { source: 'origin', delivery: false });
    if (!verdict.ok) {
      known.rejected.add(itemHash);
      writes.push(['INSERT INTO rejected (actor, item, history, at) VALUES (?, ?, ?, ?) ON CONFLICT (actor, item, history) DO NOTHING', [origin, itemHash, historyTag, now]]);
      if (!pruned) {
        writes.push(['DELETE FROM rejected WHERE actor = ? AND at < ?', [origin, now - 30 * DAY]]);
        pruned = true;
      }
      return 'invalid';
    }
    const time = effectiveUpdated(activity);
    if (!lastActivity || timeOf(time) > timeOf(lastActivity)) lastActivity = time;
    return 'ok';
  };

  for (const [index, activity] of page.items.entries()) {
    if (!page.itemOk[index] || activity.actor !== origin) continue;
    const time = effectiveUpdated(activity);
    const at = timeOf(time);
    const version = `${time} ${activity.proof.value}`;

    if (activity.type === 'post') {
      const previous = known.feed.get(activity.id);
      if (previous?.version === version) continue;
      if (previous && !(at > previous.at)) continue;
      const tomb = known.tombs.get(activity.id);
      // Withdrawn: only a version later than the withdrawal brings it back.
      if (tomb && !(at > tomb.deleted)) continue;
      const verdict = await check(activity, index);
      if (verdict === 'later') return { complete: false, events, lastActivity };
      if (verdict !== 'ok') continue;
      writes.push([
        'INSERT INTO feed (actor, id, version, published, activity) VALUES (?, ?, ?, ?, ?) ON CONFLICT (actor, id) DO UPDATE SET version = excluded.version, published = excluded.published, activity = excluded.activity',
        [origin, activity.id, version, new Date(timeOf(activity.published)).toISOString(), JSON.stringify(activity)],
      ]);
      if (tomb) {
        writes.push(['DELETE FROM tombstones WHERE actor = ? AND target = ?', [origin, activity.id]]);
        known.tombs.delete(activity.id);
      }
      known.feed.set(activity.id, { version, at, activity: JSON.stringify(activity) });
      if (!previous && !tomb && baseline) {
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
    } else if (activity.type === 'delete') {
      const of = String(activity.object?.of ?? '');
      const tomb = known.tombs.get(of);
      if (tomb?.version === version) continue;
      if (tomb && !(at > tomb.deleted)) continue;
      const stored = known.feed.get(of);
      // A post republished after this withdrawal stays.
      if (stored && stored.at > at) continue;
      // Authorship first (cheap), then the signature: an invalid or foreign
      // withdrawal leaves no tombstone at all.
      if (!checkDelete(activity, stored ? { target: JSON.parse(stored.activity) } : {}).ok) continue;
      const verdict = await check(activity, index);
      if (verdict === 'later') return { complete: false, events, lastActivity };
      if (verdict !== 'ok') continue;
      writes.push(
        ['INSERT INTO tombstones (actor, target, deleted, version) VALUES (?, ?, ?, ?) ON CONFLICT (actor, target) DO UPDATE SET deleted = excluded.deleted, version = excluded.version', [origin, of, at, version]],
        ['DELETE FROM feed WHERE actor = ? AND id = ?', [origin, of]],
      );
      known.tombs.set(of, { deleted: at, version });
      known.feed.delete(of);
    } else if (activity.type === 'key') {
      // A hint that the key log changed: read the manifest and log next time.
      writes.push(['UPDATE islands SET manifest_at = 0 WHERE origin = ?', [origin]]);
    }
    // Bottles and moves come with phase 3.
  }
  return { complete: true, events, lastActivity };
}

/**
 * Who they follow, once a day: for "friend of a friend", and whether they
 * follow us. Skipped when the budget is short; never fails the island.
 * @param {PollContext} ctx @param {string} origin @param {Record<string, any>} manifest
 * @param {Record<string, any> | null} row @param {number} now @param {[string, unknown[]][]} writes
 */
async function readFriends(ctx, origin, manifest, row, now, writes) {
  const friendsAt = Number(row?.friends_at ?? 0);
  if (typeof manifest.links.friends !== 'string' || now - friendsAt < POLL.friendsEvery || !ctx.budget.has(2)) return;
  try {
    const friends = await ctx.net.get(manifest.links.friends, { sameOriginAs: origin, limit: 512 * 1024 });
    if (friends.status !== 200) return;
    const doc = parseJson(friends.body);
    if (!validateFriends(doc).ok || doc.owner !== origin) return;
    const list = doc.items.map((/** @type {{ id: string }} */ entry) => entry.id);
    writes.push([
      'UPDATE islands SET friends = ?, friends_at = ?, follower = MAX(follower, ?) WHERE origin = ?',
      [JSON.stringify(list), now, list.includes(ctx.self) ? 1 : 0, origin],
    ]);
  } catch (error) {
    if (!(error instanceof OutboundError) && !(error instanceof BudgetExceeded)) throw error;
  }
}
