// Inbox checks that need no network (protocol section "收件箱", steps 1 to 5).
//
// The result says what to answer and whether to go on. Step 6 (signature
// against the key history) and step 7 (policy, relationship tiers, rate
// limits) happen in the island service.
//
// Record an id as seen only after the activity passed step 6 and was
// accepted; otherwise a forged copy could block the real one.

import { LIMITS, isKnownType, isDirectedType, validateActivity } from './activity.js';
import { isPlainObject, timeOf } from './util.js';

export const DELIVERY_WINDOW = Object.freeze({
  pastMs: 48 * 60 * 60 * 1000,
  futureMs: 10 * 60 * 1000,
});

/**
 * @typedef {{ status: 202, action: 'drop', reason: string }
 *   | { status: 400 | 413, action: 'reject', reason: string }
 *   | { status: null, action: 'verify', activity: Record<string, any> }} PrecheckResult
 */

/**
 * @param {string | Uint8Array} body the raw request body
 * @param {{
 *   self: string,
 *   now: number,
 *   seen: (actor: string, id: string) => boolean,
 * }} context
 *   self: this island's origin; now: milliseconds since the epoch;
 *   seen: whether (actor, id) was accepted within the last 7 days
 * @returns {PrecheckResult}
 */
export function precheckDelivery(body, { self, now, seen }) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  if (bytes.length > LIMITS.activityBytes) return { status: 413, action: 'reject', reason: 'too-large' };

  let activity;
  try {
    activity = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { status: 400, action: 'reject', reason: 'invalid-json' };
  }

  const result = validateActivity(activity);
  const envelopeBroken = result.issues.some((issue) => ENVELOPE_CODES.has(issue.code));
  if (!isPlainObject(activity) || envelopeBroken) return { status: 400, action: 'reject', reason: 'invalid-envelope' };

  // Step 2: the type decides what happens next.
  if (!isKnownType(activity.type)) return { status: 202, action: 'drop', reason: 'unknown-type' };
  if (!isDirectedType(activity.type)) return { status: 400, action: 'reject', reason: 'not-deliverable' };
  if (!result.ok) return { status: 400, action: 'reject', reason: 'invalid-activity' };

  // Step 3: addressed to this island.
  if (!activity.to.includes(self)) return { status: 400, action: 'reject', reason: 'not-addressed' };

  // Step 4: time window.
  const published = timeOf(activity.published);
  if (published < now - DELIVERY_WINDOW.pastMs) return { status: 400, action: 'reject', reason: 'too-old' };
  if (published > now + DELIVERY_WINDOW.futureMs) return { status: 400, action: 'reject', reason: 'in-the-future' };

  // Step 5: replays and retries of something already accepted.
  if (seen(activity.actor, activity.id)) return { status: 202, action: 'drop', reason: 'duplicate' };

  return { status: null, action: 'verify', activity };
}

// Issues that make the outer envelope unusable, whatever the type.
const ENVELOPE_CODES = new Set([
  'not-object',
  'invalid-type',
  'invalid-actor',
  'invalid-id',
  'id-not-on-actor-origin',
  'invalid-time',
  'updated-before-published',
  'invalid-recipients',
  'invalid-recipient',
  'duplicate-recipient',
  'invalid-object',
  'invalid-proof',
  'invalid-key-id',
  'invalid-signature-encoding',
  'too-large',
  'not-canonicalizable',
]);
