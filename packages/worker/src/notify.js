// Local notification events and the channels that carry them
// (docs/extensions.md "通知"). Events are never sent to other islands.
//
// Each event type has a mode from the owner's policy: "now" (sent right
// away, unless it is quiet hours, then right after), "digest" (collected
// and sent once a day at digestAt), or "off" (not recorded).
// Channel secrets come from the platform's secrets, never from the policy:
// TELEGRAM_BOT_TOKEN, NTFY_TOPIC (and optional NTFY_TOKEN), WEBHOOK_URL.
// When the policy lists no channels, every channel whose secrets are set is
// used (TELEGRAM_CHAT_ID and NTFY_SERVER may then come from the same
// settings), so an island built from a shared repository needs no commit.

import { checkOutboundUrl } from '../../protocol/src/index.js';

export const EVENT_TYPES = Object.freeze({
  'message.received': 'now',
  'bottle.picked': 'now',
  'stranger.pending': 'digest',
  'key.changed': 'now',
  'visit.received': 'digest',
  'water.received': 'digest',
  'follow.received': 'digest',
  'neighbor.posted': 'digest',
  'bottle.arrived': 'digest',
  'delivery.failed': 'digest',
  'reminder.record': 'off',
});
const MODES = ['now', 'digest', 'off'];
const CHANNELS = ['telegram', 'ntfy', 'webhook'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * @typedef {{ timeZone: string, quietHours: [string, string] | null, digestAt: string,
 *   rules: Record<string, 'now' | 'digest' | 'off'>, channels: Record<string, any>[] }} Policy
 */

/**
 * Checks island/notify.json. Unknown event types or channel types are errors.
 * @param {any} raw @param {string} defaultTimeZone
 * @returns {Policy}
 */
export function checkPolicy(raw = {}, defaultTimeZone = 'UTC') {
  const problems = [];
  const timeZone = raw.timezone ?? defaultTimeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    problems.push('timezone must be an IANA time zone');
  }
  const quiet = raw.quietHours ?? null;
  if (quiet !== null && !(Array.isArray(quiet) && quiet.length === 2 && quiet.every((t) => typeof t === 'string' && TIME.test(t)))) {
    problems.push('quietHours must be two times like ["23:00", "08:00"]');
  }
  const digestAt = raw.digestAt ?? '21:00';
  if (typeof digestAt !== 'string' || !TIME.test(digestAt)) problems.push('digestAt must be a time like "21:00"');
  const rules = { ...EVENT_TYPES };
  for (const [type, mode] of Object.entries(raw.rules ?? {})) {
    if (!Object.hasOwn(EVENT_TYPES, type)) problems.push(`unknown event type ${type}`);
    else if (!MODES.includes(/** @type {string} */ (mode))) problems.push(`${type} must be now, digest or off`);
    else rules[/** @type {keyof typeof EVENT_TYPES} */ (type)] = /** @type {'now'} */ (mode);
  }
  const channels = raw.channels ?? [];
  if (!Array.isArray(channels) || !channels.every((c) => c && CHANNELS.includes(c.type))) {
    problems.push(`channels must be a list of ${CHANNELS.join(', ')}`);
  }
  if (problems.length > 0) throw new TypeError(`island/notify.json: ${problems.join('; ')}`);
  return { timeZone, quietHours: quiet, digestAt, rules, channels };
}

/**
 * The channels to use: the policy's, or else those whose secrets are set.
 * @param {Record<string, any>[]} listed @param {Record<string, any>} env
 */
export function channelsFor(listed, env) {
  if (listed.length > 0) return listed;
  /** @type {Record<string, any>[]} */
  const found = [];
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) found.push({ type: 'telegram' });
  if (env.NTFY_TOPIC) found.push({ type: 'ntfy', ...(env.NTFY_SERVER ? { server: String(env.NTFY_SERVER) } : {}) });
  if (env.WEBHOOK_URL) found.push({ type: 'webhook' });
  return found;
}

/** Local "HH:MM" and date in a time zone. @param {number} now @param {string} timeZone */
export function localClock(now, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(now))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** @param {Policy} policy @param {number} now */
export function inQuietHours(policy, now) {
  if (!policy.quietHours) return false;
  const [start, end] = policy.quietHours;
  const { time } = localClock(now, policy.timeZone);
  return start <= end ? time >= start && time < end : time >= start || time < end;
}

/**
 * The statement that records an event, or null when its mode is "off".
 * @param {Policy} policy
 * @param {{ type: keyof typeof EVENT_TYPES, at: number, actor?: { id: string, name?: string }, summary: string, url?: string }} event
 * @param {'now' | 'digest'} [cap] at most this mode (strangers never notify right away)
 */
export function eventStatement(policy, event, cap = 'now') {
  let mode = policy.rules[event.type] ?? 'digest';
  if (mode === 'off') return null;
  if (cap === 'digest') mode = 'digest';
  const data = { type: event.type, at: new Date(event.at).toISOString(), ...(event.actor ? { actor: event.actor } : {}), summary: event.summary, ...(event.url ? { url: event.url } : {}) };
  return /** @type {[string, unknown[]]} */ (['INSERT INTO events (type, at, mode, data) VALUES (?, ?, ?, ?)', [event.type, event.at, mode, JSON.stringify(data)]]);
}

/**
 * Sends text and the raw events to every configured channel.
 * @param {{ fetch: typeof fetch, budget: ReturnType<typeof import('./budget.js').budget>, env: Record<string, any>, policy: Policy }} ctx
 * @param {string} title @param {string} text @param {Record<string, any>[]} events
 * @returns {Promise<string[]>} channels that failed
 */
export async function sendToChannels(ctx, title, text, events) {
  const failed = [];
  for (const channel of ctx.policy.channels) {
    const request = channelRequest(channel, ctx.env, title, text, events);
    if (!request) {
      failed.push(`${channel.type}: not configured`);
      continue;
    }
    if (!ctx.budget.has()) {
      failed.push(`${channel.type}: no budget left`);
      continue;
    }
    ctx.budget.take();
    try {
      const response = await ctx.fetch(request.url, { method: 'POST', headers: request.headers, body: request.body, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      await response.body?.cancel();
      if (!response.ok) failed.push(`${channel.type}: HTTP ${response.status}`);
    } catch {
      failed.push(`${channel.type}: network error`);
    }
  }
  return failed;
}

/**
 * @param {Record<string, any>} channel @param {Record<string, any>} env
 * @param {string} title @param {string} text @param {Record<string, any>[]} events
 * @returns {{ url: string, headers: Record<string, string>, body: string } | null}
 */
export function channelRequest(channel, env, title, text, events) {
  if (channel.type === 'telegram') {
    const chatId = channel.chatId ?? env.TELEGRAM_CHAT_ID;
    if (!env.TELEGRAM_BOT_TOKEN || !chatId) return null;
    return {
      url: `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: `${title}\n${text}`, disable_web_page_preview: true }),
    };
  }
  if (channel.type === 'ntfy') {
    if (!env.NTFY_TOPIC) return null;
    const server = channel.server ?? 'https://ntfy.sh';
    if (!checkOutboundUrl(server).ok) return null;
    return {
      url: server,
      headers: { 'content-type': 'application/json', ...(env.NTFY_TOKEN ? { authorization: `Bearer ${env.NTFY_TOKEN}` } : {}) },
      body: JSON.stringify({ topic: env.NTFY_TOPIC, title, message: text, ...(events[0]?.url ? { click: events[0].url } : {}) }),
    };
  }
  if (channel.type === 'webhook') {
    if (!env.WEBHOOK_URL || !checkOutboundUrl(env.WEBHOOK_URL).ok) return null;
    return { url: env.WEBHOOK_URL, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, text, events }) };
  }
  return null;
}

/**
 * Sends events in "now" mode that are still waiting, unless it is quiet hours.
 * @param {{ store: import('./store-d1.js').Store, now: () => number, policy: Policy, fetch: typeof fetch, budget: any, env: Record<string, any>, strings: Record<string, any> }} ctx
 */
export async function flushNow(ctx) {
  if (ctx.policy.channels.length === 0 || inQuietHours(ctx.policy, ctx.now())) return 0;
  const rows = await ctx.store.all("SELECT id, data FROM events WHERE mode = 'now' AND sent IS NULL ORDER BY id LIMIT 10");
  if (rows.length === 0) return 0;
  const events = rows.map((row) => JSON.parse(row.data));
  const failed = await sendToChannels(ctx, ctx.strings.notifyTitle, events.map((e) => e.summary).join('\n'), events);
  if (failed.length < ctx.policy.channels.length) {
    await ctx.store.run(`UPDATE events SET sent = ? WHERE id IN (${rows.map(() => '?').join(', ')})`, [ctx.now(), ...rows.map((row) => row.id)]);
  }
  return rows.length;
}

/**
 * Once a day, at or after digestAt local time, sends everything collected.
 * @param {Parameters<typeof flushNow>[0]} ctx
 */
export async function flushDigest(ctx) {
  const { date, time } = localClock(ctx.now(), ctx.policy.timeZone);
  if (ctx.policy.channels.length === 0 || time < ctx.policy.digestAt) return 0;
  const [last, rows] = await ctx.store.batch([
    ["SELECT value FROM state WHERE key = 'digest'"],
    ["SELECT id, type, data FROM events WHERE mode = 'digest' AND sent IS NULL ORDER BY id LIMIT 200"],
  ]);
  if (last[0]?.value === date || rows.length === 0) return 0;
  const events = rows.map((row) => JSON.parse(row.data));
  const strangers = events.filter((e) => e.type === 'stranger.pending').length;
  const lines = events.filter((e) => e.type !== 'stranger.pending').slice(0, 20).map((e) => e.summary);
  if (strangers > 0) lines.push(ctx.strings.strangerCount(strangers));
  const rest = events.length - strangers - Math.min(20, events.length - strangers);
  if (rest > 0) lines.push(ctx.strings.more(rest));
  const failed = await sendToChannels(ctx, ctx.strings.digestTitle, lines.join('\n'), events.filter((e) => e.type !== 'stranger.pending').slice(0, 20));
  if (failed.length === ctx.policy.channels.length) return 0;
  await ctx.store.batch([
    [`UPDATE events SET sent = ? WHERE id IN (${rows.map(() => '?').join(', ')})`, [ctx.now(), ...rows.map((row) => row.id)]],
    ["INSERT INTO state (key, value) VALUES ('digest', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", [date]],
    ['DELETE FROM events WHERE sent IS NOT NULL AND sent < ?', [ctx.now() - 30 * 86_400_000]],
  ]);
  return rows.length;
}
