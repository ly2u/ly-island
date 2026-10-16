// Sending directed activities: follow, visit, message, water.
//
// Each activity has one recipient and is signed at send time with the
// island's key (the ISLAND_SIGNING_KEY secret, the same key that signs the
// public outbox at build time). It is stored first, then posted to the
// recipient's inbox. Retries follow the protocol's response table: 429 waits
// for Retry-After; 5xx and network errors retry at most 3 times within 24
// hours; other 4xx answers are final.

import { signActivity, validateActivity } from '../../protocol/src/index.js';
import { OutboundError } from './net.js';
import { eventStatement } from './notify.js';
import { islandColumns, learnIsland, upsertIsland } from './remote.js';

export const SENDABLE = Object.freeze(['follow', 'visit', 'message', 'water']);
/** Wait before retry n (1-based), within 24 hours in total. */
const RETRY_DELAYS_MS = [60 * 60 * 1000, 4 * 60 * 60 * 1000, 12 * 60 * 60 * 1000];
const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1;

/**
 * @typedef {object} SendContext
 * @property {string} self
 * @property {{ keyId: string, privateKey: CryptoKey } | null} signer
 * @property {import('./store-d1.js').Store} store
 * @property {ReturnType<typeof import('./net.js').outbound>} net
 * @property {() => number} now
 * @property {import('./notify.js').Policy} policy
 * @property {ReturnType<typeof import('./strings.js').stringsFor>} strings
 */

/**
 * Creates, stores and sends one activity.
 * @param {SendContext} ctx
 * @param {{ type: string, to: string, object?: Record<string, unknown> }} request
 * @returns {Promise<{ ok: boolean, status: string, id?: string, reason?: string }>}
 */
export async function send(ctx, { type, to, object = {} }) {
  if (!ctx.signer) return { ok: false, status: 'not-sent', reason: 'no-signing-key' };
  if (!SENDABLE.includes(type)) return { ok: false, status: 'not-sent', reason: 'unknown-type' };
  if (to === ctx.self) return { ok: false, status: 'not-sent', reason: 'to-self' };
  const now = ctx.now();
  const unsigned = {
    id: `${ctx.self}/island/a/${crypto.randomUUID()}`,
    type,
    actor: ctx.self,
    published: new Date(Math.floor(now / 1000) * 1000).toISOString().replace('.000Z', 'Z'),
    to: [to],
    object,
  };
  const activity = await signActivity(unsigned, ctx.signer);
  const check = validateActivity(activity);
  if (!check.ok) return { ok: false, status: 'not-sent', reason: `invalid-activity ${JSON.stringify(check.issues.map((issue) => issue.code))}` };
  await ctx.store.run(
    "INSERT INTO sent (id, recipient, type, activity, created, status, attempts, next_at) VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)",
    [activity.id, to, type, JSON.stringify(activity), now, now],
  );
  const result = await attempt(ctx, { id: activity.id, recipient: to, activity: JSON.stringify(activity), attempts: 0 });
  return { ...result, id: activity.id };
}

/**
 * One delivery attempt for a stored activity, saving the outcome.
 * @param {SendContext} ctx
 * @param {{ id: string, recipient: string, activity: string, attempts: number }} row
 */
export async function attempt(ctx, row) {
  const now = ctx.now();
  const attempts = Number(row.attempts) + 1;
  /** @type {[string, unknown[]][]} */
  const writes = [];
  const outcome = await post(ctx, row, writes);

  let status;
  let nextAt = null;
  if (outcome.kind === 'delivered') {
    status = 'delivered';
  } else if (outcome.kind === 'final') {
    status = 'failed';
  } else if (outcome.kind === 'wait') {
    status = 'pending';
    nextAt = now + outcome.seconds * 1000;
  } else if (attempts >= MAX_ATTEMPTS) {
    status = 'failed';
  } else {
    status = 'pending';
    nextAt = now + RETRY_DELAYS_MS[attempts - 1];
  }
  writes.push([
    'UPDATE sent SET status = ?, attempts = ?, next_at = ?, last_error = ? WHERE id = ?',
    [status, outcome.kind === 'wait' ? attempts - 1 : attempts, nextAt, outcome.kind === 'delivered' ? null : outcome.reason, row.id],
  ]);
  if (status === 'failed') {
    const event = eventStatement(ctx.policy, {
      type: 'delivery.failed',
      at: now,
      actor: { id: row.recipient },
      summary: ctx.strings.deliveryFailed(row.recipient),
      url: `${ctx.self}/island/admin/#sent`,
    });
    if (event) writes.push(event);
  }
  await ctx.store.batch(writes);
  return { ok: status === 'delivered', status, ...(outcome.kind === 'delivered' ? {} : { reason: outcome.reason }) };
}

/**
 * Posts a stored activity to its recipient's inbox.
 * @param {SendContext} ctx
 * @param {{ recipient: string, activity: string }} row
 * @param {[string, unknown[]][]} writes
 * @returns {Promise<{ kind: 'delivered' } | { kind: 'final' | 'retry', reason: string } | { kind: 'wait', seconds: number, reason: string }>}
 */
async function post(ctx, row, writes) {
  const island = await ctx.store.first('SELECT * FROM islands WHERE origin = ?', [row.recipient]);
  const learned = await learnIsland(ctx, row.recipient, island);
  if (!learned.ok) return { kind: learned.retry ? 'retry' : 'final', reason: learned.reason };
  if (learned.fetched) writes.push(upsertIsland(row.recipient, ctx.now(), islandColumns(learned, ctx.now())));
  const inbox = learned.manifest.links?.inbox;
  if (typeof inbox !== 'string') return { kind: 'final', reason: 'no-inbox' };

  let response;
  try {
    response = await ctx.net.post(inbox, new TextEncoder().encode(row.activity), { sameOriginAs: row.recipient });
  } catch (error) {
    if (!(error instanceof OutboundError)) throw error;
    // Address rules and refused redirects will not change by retrying.
    const final = !['timeout', 'network-error'].includes(error.reason);
    return { kind: final ? 'final' : 'retry', reason: error.reason };
  }
  if (response.status >= 200 && response.status < 300) return { kind: 'delivered' };
  if (response.status === 429) return { kind: 'wait', seconds: Math.max(60, response.retryAfter ?? 3600), reason: 'HTTP 429' };
  if (response.status >= 500) return { kind: 'retry', reason: `HTTP ${response.status}` };
  return { kind: 'final', reason: `HTTP ${response.status}` };
}

/**
 * Retries deliveries that are due, oldest first, while the budget lasts.
 * @param {SendContext & { budget: ReturnType<typeof import('./budget.js').budget> }} ctx
 * @param {number} [limit]
 */
export async function retryDue(ctx, limit = 5) {
  const due = await ctx.store.all(
    "SELECT id, recipient, activity, attempts FROM sent WHERE status = 'pending' AND next_at <= ? ORDER BY next_at LIMIT ?",
    [ctx.now(), limit],
  );
  let done = 0;
  for (const row of due) {
    if (!ctx.budget.has(4)) break;
    await attempt(ctx, /** @type {any} */ (row));
    done += 1;
  }
  return done;
}
