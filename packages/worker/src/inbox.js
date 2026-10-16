// The inbox (protocol "收件箱"). Steps 1 to 5 cost nothing but CPU; step 6
// reads the sender's manifest only when we have no fresh copy; step 7
// applies this island's policy. One read batch and one write batch per
// accepted delivery, so a delivery costs 2 to 5 subrequests.
//
// An (actor, id) is recorded as seen only after it was verified and accepted
// (or silently dropped for a blocked sender), so a forged copy cannot block
// the real one.

import { precheckDelivery, verifyActivity } from '../../protocol/src/index.js';
import { eventStatement } from './notify.js';
import { registrableDomain } from './psl.js';
import { islandColumns, learnIsland, upsertIsland } from './remote.js';
import { clip } from './strings.js';

export const INBOX_LIMITS = Object.freeze({
  bodyBytes: 16 * 1024,
  perActorHour: 30,
  perDomainHour: 30,
  newIslandMs: 7 * 24 * 60 * 60 * 1000,
  seenMs: 7 * 24 * 60 * 60 * 1000,
});
const HOUR_MS = 3_600_000;

/** @param {number} status @param {string} reason @param {Record<string, string>} [headers] */
function answer(status, reason, headers = {}) {
  return new Response(JSON.stringify({ status, reason }), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** Reads at most `limit` bytes; null when the body is longer. @param {Request} request @param {number} limit */
async function readBody(request, limit) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return body;
}

/**
 * @typedef {object} InboxContext
 * @property {string} self
 * @property {Record<string, any>} manifest this island's manifest
 * @property {Set<string>} publicFriends islands listed in this island's friends.json
 * @property {import('./store-d1.js').Store} store
 * @property {ReturnType<typeof import('./net.js').outbound>} net
 * @property {() => number} now
 * @property {import('./notify.js').Policy} policy
 * @property {ReturnType<typeof import('./strings.js').stringsFor>} strings
 * @property {(promise: Promise<unknown>) => void} later runs after the response
 * @property {() => Promise<unknown>} flushNotifications
 */

/** @param {InboxContext} ctx @param {Request} request */
export async function receive(ctx, request) {
  if (request.method !== 'POST') return answer(405, 'method-not-allowed', { allow: 'POST' });
  if (!/^application\/json\s*(;|$)/i.test(request.headers.get('content-type') ?? '')) return answer(400, 'not-json');
  const body = await readBody(request, INBOX_LIMITS.bodyBytes);
  if (body === null) return answer(413, 'too-large');

  const now = ctx.now();
  // Steps 1 to 4; step 5 needs the store, below.
  const pre = precheckDelivery(body, { self: ctx.self, now, seen: () => false });
  if (pre.action !== 'verify') return answer(pre.status, pre.reason);
  const activity = pre.activity;
  const { actor, id, type } = activity;
  const domain = registrableDomain(new URL(actor).hostname);
  const hour = Math.floor(now / HOUR_MS);

  const [seenRows, islandRows, rateRows, friendOfFriend] = await ctx.store.batch([
    ['SELECT 1 AS hit FROM seen WHERE actor = ? AND id = ? AND at > ?', [actor, id, now - INBOX_LIMITS.seenMs]],
    ['SELECT * FROM islands WHERE origin = ?', [actor]],
    ['SELECT key, count FROM rate WHERE hour = ? AND key IN (?, ?)', [hour, `actor ${actor}`, `domain ${domain}`]],
    [
      'SELECT 1 AS hit FROM islands AS n, json_each(n.friends) AS f WHERE n.following = 1 AND n.follower = 1 AND f.value = ? LIMIT 1',
      [actor],
    ],
  ]);
  // Step 5: already accepted.
  if (seenRows.length > 0) return answer(202, 'duplicate');
  const island = islandRows[0] ?? null;
  if (island?.blocked) {
    await ctx.store.run('INSERT INTO seen (actor, id, at) VALUES (?, ?, ?) ON CONFLICT (actor, id) DO UPDATE SET at = excluded.at', [actor, id, now]);
    return answer(202, 'accepted');
  }

  // Step 6: the signature, against our key history for the sender.
  let learned = await learnIsland(ctx, actor, island);
  if (!learned.ok) {
    return learned.retry ? answer(503, `cannot-read-sender-${learned.reason}`, { 'retry-after': '600' }) : answer(401, learned.reason);
  }
  let verdict = learned.paused ? { ok: false, reason: 'sender-paused' } : await verifyActivity(learned.history, activity, { source: 'origin', delivery: true });
  if (!verdict.ok && !learned.paused && !learned.fetched && verdict.reason === 'unknown-key') {
    learned = await learnIsland(ctx, actor, island, { force: true });
    if (!learned.ok) return answer(learned.retry ? 503 : 401, learned.reason);
    verdict = learned.paused ? { ok: false, reason: 'sender-paused' } : await verifyActivity(learned.history, activity, { source: 'origin', delivery: true });
  }
  /** @type {[string, unknown[]][]} */
  const writes = [];
  const name = String(learned.manifest.name ?? actor);
  if (learned.fetched) {
    writes.push(upsertIsland(actor, now, islandColumns(learned, now)));
    const wasPaused = JSON.parse(island?.history ?? 'null')?.status === 'paused';
    if (learned.paused && !wasPaused) {
      const keyEvent = eventStatement(ctx.policy, { type: 'key.changed', at: now, actor: { id: actor, name }, summary: ctx.strings.keyChanged(name) });
      if (keyEvent) writes.push(keyEvent);
    }
  }
  if (!verdict.ok) {
    if (writes.length > 0) await ctx.store.batch(writes);
    return answer(401, verdict.reason ?? 'bad-signature');
  }

  // Step 7: this island's policy.
  const following = island?.following === 1 || ctx.publicFriends.has(actor);
  const accepts = ctx.manifest.accepts?.[type] ?? (ctx.manifest.links?.inbox ? 'signed' : 'none');
  if (accepts === 'none') return answer(403, 'not-accepted');
  if (accepts === 'friends' && !following) return answer(403, 'friends-only');

  const isNew = !island || now - Number(island.first_seen) < INBOX_LIMITS.newIslandMs;
  const counts = Object.fromEntries(rateRows.map((row) => [row.key, Number(row.count)]));
  const actorLimit = isNew ? INBOX_LIMITS.perActorHour / 2 : INBOX_LIMITS.perActorHour;
  if ((counts[`actor ${actor}`] ?? 0) >= actorLimit || (counts[`domain ${domain}`] ?? 0) >= INBOX_LIMITS.perDomainHour) {
    if (writes.length > 0) await ctx.store.batch(writes);
    return answer(429, 'rate-limited', { 'retry-after': String(Math.ceil(((hour + 1) * HOUR_MS - now) / 1000)) });
  }

  // Relationship tier (protocol "按关系分级").
  const follower = island?.follower === 1 || type === 'follow';
  const tier = island?.allowed === 1 || (following && follower) ? 'neighbor' : friendOfFriend.length > 0 ? 'friend-of-friend' : 'stranger';
  const folder = tier === 'stranger' ? 'strangers' : 'inbox';

  writes.push(
    ['INSERT INTO received (actor, id, type, folder, received, activity) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (actor, id) DO NOTHING', [actor, id, type, folder, now, JSON.stringify(activity)]],
    ['INSERT INTO seen (actor, id, at) VALUES (?, ?, ?) ON CONFLICT (actor, id) DO UPDATE SET at = excluded.at', [actor, id, now]],
    ['INSERT INTO rate (key, hour, count) VALUES (?, ?, 1) ON CONFLICT (key, hour) DO UPDATE SET count = count + 1', [`actor ${actor}`, hour]],
    ['INSERT INTO rate (key, hour, count) VALUES (?, ?, 1) ON CONFLICT (key, hour) DO UPDATE SET count = count + 1', [`domain ${domain}`, hour]],
    upsertIsland(actor, now, {}, { follower: type === 'follow' ? 1 : 0 }),
    ['DELETE FROM seen WHERE at < ?', [now - INBOX_LIMITS.seenMs]],
    ['DELETE FROM rate WHERE hour < ?', [hour - 48]],
  );
  const event = eventFor(ctx, activity, name, tier, now);
  if (event) writes.push(event);
  await ctx.store.batch(writes);
  ctx.later(ctx.flushNotifications());
  return answer(202, 'accepted');
}

/**
 * @param {InboxContext} ctx @param {Record<string, any>} activity @param {string} name
 * @param {'neighbor' | 'friend-of-friend' | 'stranger'} tier @param {number} now
 */
function eventFor(ctx, activity, name, tier, now) {
  const actor = { id: activity.actor, name };
  const url = `${ctx.self}/island/admin/#inbox`;
  if (tier === 'stranger') {
    return eventStatement(ctx.policy, { type: 'stranger.pending', at: now, actor, summary: ctx.strings.strangerCount(1), url }, 'digest');
  }
  const cap = tier === 'neighbor' ? 'now' : 'digest';
  const s = ctx.strings;
  switch (activity.type) {
    case 'message':
      return eventStatement(ctx.policy, { type: 'message.received', at: now, actor, summary: s.message(name, clip(activity.object.text)), url }, cap);
    case 'visit':
      return eventStatement(ctx.policy, { type: 'visit.received', at: now, actor, summary: s.visit(name), url }, cap);
    case 'water':
      return eventStatement(ctx.policy, { type: 'water.received', at: now, actor, summary: s.water(name), url }, cap);
    case 'follow':
      return eventStatement(ctx.policy, { type: 'follow.received', at: now, actor, summary: s.follow(name), url }, cap);
    default:
      return null;
  }
}
