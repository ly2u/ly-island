import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { importPrivateSeed, signActivity } from '../../protocol/src/index.js';
import { channels, clock, island, network, SEEDS } from './harness.js';

/** @param {string} hex */
const seedBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));

/** Signs a directed activity as `from`. */
async function signed(from, seed, to, fields = {}, time) {
  const activity = {
    id: `${from}/island/a/${crypto.randomUUID()}`,
    type: 'message',
    actor: from,
    published: new Date(time.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    to: [to],
    object: { text: '你好' },
    ...fields,
  };
  return signActivity(activity, { keyId: `${from}#k1`, privateKey: await importPrivateSeed(seedBytes(seed)) });
}

async function setup({ accepts = {}, bFriends = [] } = {}) {
  const net = network();
  const time = clock();
  const sent = channels(net);
  const notify = { timezone: 'UTC', channels: [{ type: 'telegram', chatId: '1' }] };
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, name: '甲岛' });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, name: '乙岛', accepts, friends: bFriends, notify, env: { TELEGRAM_BOT_TOKEN: 't' } });
  const deliver = (/** @type {unknown} */ body, headers = {}) =>
    b.request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { net, time, sent, a, b, deliver, sign: (fields = {}) => signed(a.origin, SEEDS.a, b.origin, fields, time) };
}

const reason = async (/** @type {Response} */ response) => (await response.json()).reason;

describe('the inbox follows the protocol steps', () => {
  test('a valid message is accepted once; a replay is answered 202 and dropped', async () => {
    const { b, deliver, sign } = await setup();
    const activity = await sign();
    assert.equal((await deliver(activity)).status, 202);
    const replay = await deliver(activity);
    assert.equal(replay.status, 202);
    assert.equal(await reason(replay), 'duplicate');
    assert.equal((await b.rows('SELECT * FROM received')).length, 1);
  });

  test('a changed byte breaks the signature: 401, nothing stored, and the real one still gets in', async () => {
    const { b, deliver, sign } = await setup();
    const activity = await sign();
    const forged = { ...activity, object: { text: '改过的' } };
    const response = await deliver(forged);
    assert.equal(response.status, 401);
    assert.equal(await reason(response), 'bad-signature');
    assert.equal((await b.rows('SELECT * FROM received')).length, 0);
    // The forged copy used the same id: it must not block the real one.
    assert.equal((await deliver(activity)).status, 202);
  });

  test('size, format, type, recipient and time are checked before any network use', async () => {
    const { net, time, deliver, sign } = await setup();
    const before = net.count((entry) => entry.url.startsWith('https://a.example'));
    assert.equal((await deliver('x'.repeat(16 * 1024 + 1))).status, 413);
    assert.equal(await reason(await deliver('{not json')), 'invalid-json');
    assert.equal((await deliver(await sign(), { 'content-type': 'text/plain' })).status, 400);
    const unknown = await deliver(await sign({ type: 'hug' }));
    assert.deepEqual([unknown.status, await reason(unknown)], [202, 'unknown-type']);
    assert.equal(await reason(await deliver(await sign({ type: 'post', to: 'public', object: { url: 'https://a.example/x', kind: 'note' } }))), 'not-deliverable');
    assert.equal(await reason(await deliver(await sign({ to: ['https://c.example'] }))), 'not-addressed');
    assert.equal(await reason(await deliver(await sign({ published: new Date(time.now() - 49 * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z') }))), 'too-old');
    assert.equal(await reason(await deliver(await sign({ published: new Date(time.now() + 11 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z') }))), 'in-the-future');
    assert.equal(net.count((entry) => entry.url.startsWith('https://a.example')), before, 'no request to the sender for any of these');
  });

  test('rate limits: a new island gets 15 an hour, then 429 with Retry-After', async () => {
    const { deliver, sign } = await setup();
    for (let i = 0; i < 15; i += 1) assert.equal((await deliver(await sign())).status, 202, `delivery ${i + 1}`);
    const limited = await deliver(await sign());
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
  });

  test('rate limits add up all islands under one registrable domain', async () => {
    const net = network();
    const time = clock();
    const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b });
    // 31 islands under one domain, each sending once.
    const statuses = [];
    for (let i = 0; i < 31; i += 1) {
      const seed = (0x40 + i).toString(16).repeat(32);
      const origin = `https://s${i}.spam.example`;
      await island({ net, time, origin, seed });
      const activity = await signed(origin, seed, b.origin, {}, time);
      const response = await b.request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(activity) });
      statuses.push(response.status);
    }
    assert.deepEqual(statuses.slice(0, 30), Array(30).fill(202));
    assert.equal(statuses[30], 429);
  });

  test('blocked senders are answered 202 and dropped; accepts "friends" refuses strangers', async () => {
    const blocked = await setup();
    await blocked.b.store.run("INSERT INTO islands (origin, first_seen, blocked) VALUES ('https://a.example', 0, 1)");
    const response = await blocked.deliver(await blocked.sign());
    assert.equal(response.status, 202);
    assert.equal((await blocked.b.rows('SELECT * FROM received')).length, 0);

    const picky = await setup({ accepts: { message: 'friends' } });
    const refused = await picky.deliver(await picky.sign());
    assert.deepEqual([refused.status, await reason(refused)], [403, 'friends-only']);
    const pickup = await picky.deliver(await picky.sign({ type: 'pickup', object: { of: 'https://b.example/island/b/1' } }));
    assert.deepEqual([pickup.status, await reason(pickup)], [403, 'not-accepted']);
  });

  test('strangers go to "陌生来信" and only count in the digest; neighbors notify right away', async () => {
    const { sent, b, deliver, sign } = await setup();
    await deliver(await sign());
    const [row] = await b.rows('SELECT folder FROM received');
    assert.equal(row.folder, 'strangers');
    assert.deepEqual((await b.rows('SELECT type, mode FROM events')).map((e) => [e.type, e.mode]), [['stranger.pending', 'digest']]);
    assert.equal(sent.length, 0);

    const friendly = await setup({ bFriends: [{ id: 'https://a.example', name: '甲岛' }] });
    await friendly.b.store.run("INSERT INTO islands (origin, first_seen, follower) VALUES ('https://a.example', 0, 1)");
    await friendly.deliver(await friendly.sign());
    assert.equal((await friendly.b.rows('SELECT folder FROM received'))[0].folder, 'inbox');
    assert.equal(friendly.sent.length, 1);
  });

  test('a key the history cannot explain pauses the sender: 401, and the owner is told once', async () => {
    const { a, b, time, deliver, sign } = await setup();
    assert.equal((await deliver(await sign())).status, 202);
    // A day later the sender's manifest lists another key, and there is no key log to explain it.
    time.advance(25 * 3_600_000);
    await a.rekey('e5'.repeat(32));
    const first = await deliver(await signed(a.origin, 'e5'.repeat(32), b.origin, {}, time));
    assert.deepEqual([first.status, await reason(first)], [401, 'sender-paused']);
    const second = await deliver(await signed(a.origin, 'e5'.repeat(32), b.origin, {}, time));
    assert.equal(second.status, 401);
    // Even the old key is no longer accepted while paused, and the owner was told exactly once.
    assert.equal((await deliver(await sign())).status, 401);
    assert.deepEqual((await b.rows("SELECT type, mode FROM events WHERE type = 'key.changed'")).map((e) => e.mode), ['now']);
    assert.equal((await b.rows('SELECT * FROM received')).length, 1);
  });
});
