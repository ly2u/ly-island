import assert from 'node:assert/strict';
import { test } from 'node:test';

import { budget } from '../src/budget.js';
import { channelsFor, checkPolicy, eventStatement, flushDigest, flushNow, inQuietHours } from '../src/notify.js';
import { migrate, SCHEMA_VERSION } from '../src/schema.js';
import { sqliteStore } from '../src/store-node.js';
import { stringsFor } from '../src/strings.js';
import { channels, network } from './harness.js';

async function setup(raw, env = { TELEGRAM_BOT_TOKEN: 't', NTFY_TOPIC: 'secret-topic', WEBHOOK_URL: 'https://hooks.example/in' }) {
  const store = sqliteStore();
  await migrate(store);
  const net = network();
  const sent = channels(net);
  let time = 0;
  const ctx = { store, now: () => time, policy: checkPolicy(raw, 'UTC'), fetch: net.fetch, budget: budget(45), env, strings: stringsFor('zh-CN') };
  const record = async (type, summary) => {
    const statement = eventStatement(ctx.policy, { type, at: time, summary });
    if (statement) await store.run(...statement);
  };
  return { store, sent, ctx, record, at: (/** @type {string} */ iso) => (time = Date.parse(iso)) };
}

test('quiet hours hold immediate events until they end, in the policy time zone', async () => {
  const { sent, ctx, record, at } = await setup({ timezone: 'Asia/Shanghai', quietHours: ['23:00', '08:00'], channels: [{ type: 'telegram', chatId: '7' }] });
  at('2026-10-14T15:30:00Z'); // 23:30 in Shanghai
  await record('message.received', '甲岛给你留言：晚安');
  assert.equal(await flushNow(ctx), 0);
  at('2026-10-14T23:59:00Z'); // 07:59
  assert.equal(await flushNow(ctx), 0);
  at('2026-10-15T00:00:00Z'); // 08:00
  assert.equal(await flushNow(ctx), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.chat_id, '7');
  assert.match(sent[0].body.text, /晚安/);
  assert.equal(await flushNow(ctx), 0, 'sent once');
  assert.equal(inQuietHours(ctx.policy, Date.parse('2026-10-14T14:00:00Z')), false); // 22:00
});

test('the digest goes out once a day at digestAt, with strangers only counted', async () => {
  const { sent, ctx, record, at, store } = await setup({ timezone: 'UTC', digestAt: '21:00', channels: [{ type: 'telegram', chatId: '1' }, { type: 'ntfy', server: 'https://ntfy.example' }, { type: 'webhook' }] });
  at('2026-10-14T10:00:00Z');
  await record('visit.received', '甲岛来拜访过');
  await record('water.received', '乙岛给你浇了水');
  await record('stranger.pending', '陌生来信里有 1 封新信');
  await record('stranger.pending', '陌生来信里有 1 封新信');
  await record('reminder.record', '该写点东西了');
  assert.equal((await store.all('SELECT * FROM events')).length, 4, 'reminder.record is off by default');
  at('2026-10-14T20:59:00Z');
  assert.equal(await flushDigest(ctx), 0);
  at('2026-10-14T21:00:00Z');
  assert.equal(await flushDigest(ctx), 4);
  const telegram = sent.find((entry) => entry.channel === 'telegram').body.text;
  assert.match(telegram, /今天岛上的事\n甲岛来拜访过\n乙岛给你浇了水\n陌生来信里有 2 封新信/);
  const ntfy = sent.find((entry) => entry.channel === 'ntfy').body;
  assert.equal(ntfy.topic, 'secret-topic');
  const webhook = sent.find((entry) => entry.channel === 'webhook').body;
  assert.equal(webhook.events.length, 2, 'stranger events are summarized, not listed');
  await record('visit.received', '丙岛来拜访过');
  at('2026-10-14T23:00:00Z');
  assert.equal(await flushDigest(ctx), 0, 'one digest per day');
  at('2026-10-15T21:05:00Z');
  assert.equal(await flushDigest(ctx), 1);
});

test('channels without their secret are skipped; bad policies are refused', async () => {
  const { sent, ctx, record, at } = await setup({ channels: [{ type: 'telegram', chatId: '1' }] }, {});
  at('2026-10-14T12:00:00Z');
  await record('message.received', 'x');
  assert.equal(await flushNow(ctx), 1);
  assert.equal(sent.length, 0);
  assert.equal((await ctx.store.all('SELECT * FROM events WHERE sent IS NULL')).length, 1, 'kept for later');
  assert.throws(() => checkPolicy({ rules: { 'message.received': 'loud' } }), /now, digest or off/);
  assert.throws(() => checkPolicy({ rules: { 'party.started': 'now' } }), /unknown event type/);
  assert.throws(() => checkPolicy({ quietHours: ['25:00', '08:00'] }), /quietHours/);
  assert.throws(() => checkPolicy({ channels: [{ type: 'email' }] }), /channels/);
  assert.throws(() => checkPolicy({ timezone: 'Mars/Olympus' }), /timezone/);
});

test('with no channels listed, the channels whose secrets are set are used', async () => {
  assert.deepEqual(channelsFor([], {}), []);
  assert.deepEqual(channelsFor([], { TELEGRAM_BOT_TOKEN: 't' }), [], 'Telegram also needs the chat');
  assert.deepEqual(
    channelsFor([], { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '7', NTFY_TOPIC: 'x', NTFY_SERVER: 'https://ntfy.example', WEBHOOK_URL: 'https://hooks.example/in' }).map((c) => c.type),
    ['telegram', 'ntfy', 'webhook'],
  );
  assert.deepEqual(channelsFor([{ type: 'ntfy' }], { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '7' }), [{ type: 'ntfy' }], 'a listed policy wins');
  const { sent, ctx, record, at } = await setup({}, { TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '42' });
  ctx.policy = { ...ctx.policy, channels: channelsFor(ctx.policy.channels, ctx.env) };
  at('2026-10-14T12:00:00Z');
  await record('message.received', 'hello');
  assert.equal(await flushNow(ctx), 1);
  assert.equal(sent[0].body.chat_id, '42');
});

test('migrations are idempotent and versioned', async () => {
  const store = sqliteStore();
  assert.equal(await migrate(store), 0);
  assert.equal(await migrate(store), SCHEMA_VERSION);
  assert.equal(await migrate(store), SCHEMA_VERSION);
  const tables = (await store.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((row) => row.name);
  for (const table of ['drafts', 'events', 'feed', 'islands', 'meta', 'rate', 'received', 'seen', 'sent', 'state', 'tokens']) assert.ok(tables.includes(table), table);
});
