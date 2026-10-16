// Key logs of islands we already trust (protocol "首次信任与密钥历史"):
// a log that cannot be read right now changes nothing and is tried again;
// a log that is missing, invalid or rewritten pauses the island.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { islandSigner } from '../../core/src/index.js';
import { importPrivateSeed, signActivity } from '../../protocol/src/index.js';
import { clock, island, network, SEEDS } from './harness.js';

const DAY = 86_400_000;
/** @param {string} hex */
const seedBytes = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));

/** A key log entry of `origin`, signed with its k1, that adds a second key. */
async function addKeyEntry(origin, seed) {
  const signer = await islandSigner({ ISLAND_SIGNING_KEY: seed }, { origin, keyName: 'k1' });
  const second = await islandSigner({ ISLAND_SIGNING_KEY: 'f6'.repeat(32) }, { origin, keyName: 'k2' });
  return signActivity(
    { id: `${origin}/island/keys/1`, type: 'key', actor: origin, published: '2026-10-01T00:00:00Z', to: 'public', object: { add: { id: second.keyId, type: 'Ed25519', publicKey: second.publicKey } } },
    { keyId: signer.keyId, privateKey: signer.privateKey },
  );
}

async function setup(keyLog = []) {
  const net = network();
  const time = clock();
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, keyLog });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b });
  const privateKey = await importPrivateSeed(seedBytes(SEEDS.a));
  const deliver = async () => {
    const activity = await signActivity(
      { id: `${a.origin}/island/a/${crypto.randomUUID()}`, type: 'message', actor: a.origin, published: new Date(time.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), to: [b.origin], object: { text: '你好' } },
      { keyId: `${a.origin}#k1`, privateKey },
    );
    const response = await b.request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(activity) });
    return { status: response.status, reason: (await response.json()).reason };
  };
  const row = async () => {
    const [found] = await b.rows("SELECT manifest_at, history FROM islands WHERE origin = 'https://a.example'");
    return { manifestAt: found.manifest_at, history: JSON.parse(found.history) };
  };
  return { net, time, a, b, deliver, row };
}

test('a key log that cannot be read right now: nothing changes, the sender is asked to retry', async () => {
  const { net, time, a, deliver, row } = await setup();
  assert.equal((await deliver()).status, 202);
  const trusted = await row();
  assert.equal(trusted.history.status, 'trusted');
  time.advance(DAY + 3_600_000);

  const original = net.hosts.get('a.example');
  for (const failure of [503, 'network']) {
    net.route('a.example', (request) => {
      if (new URL(request.url).pathname !== '/island/keys.json') return original(request);
      if (failure === 'network') throw new TypeError('connection reset');
      return new Response('busy', { status: failure });
    });
    const answer = await deliver();
    assert.equal(answer.status, 503, String(failure));
    assert.match(answer.reason, /key-log/);
    const now = await row();
    assert.equal(now.manifestAt, trusted.manifestAt, 'the cached manifest is not refreshed');
    assert.deepEqual(now.history, trusted.history, 'the history is unchanged');
  }
  net.route('a.example', original);
  assert.equal((await deliver()).status, 202, 'once the log can be read, deliveries are accepted again');
  assert.ok((await row()).manifestAt > trusted.manifestAt);
  void a;
});

test('a key log that turns invalid pauses the island; nothing more is accepted', async () => {
  const { time, a, deliver, row } = await setup();
  assert.equal((await deliver()).status, 202);
  time.advance(DAY + 3_600_000);
  a.serve('/island/keys.json', { not: 'a key log' });
  assert.deepEqual(await deliver(), { status: 401, reason: 'sender-paused' });
  const paused = await row();
  assert.deepEqual([paused.history.status, paused.history.pauseReason], ['paused', 'invalid-key-log']);
  assert.equal((await deliver()).status, 401);
});

test('a key log that disappears pauses the island', async () => {
  const { net, time, deliver, row } = await setup();
  assert.equal((await deliver()).status, 202);
  time.advance(DAY + 3_600_000);
  const original = net.hosts.get('a.example');
  net.route('a.example', (request) => (new URL(request.url).pathname === '/island/keys.json' ? new Response('gone', { status: 404 }) : original(request)));
  assert.equal((await deliver()).status, 401);
  assert.equal((await row()).history.pauseReason, 'invalid-key-log');
});

test('a truncated key log pauses the island: the log was rewritten', async () => {
  const entry = await addKeyEntry('https://a.example', SEEDS.a);
  const { time, a, deliver, row } = await setup([entry]);
  assert.equal((await deliver()).status, 202);
  const trusted = await row();
  assert.equal(trusted.history.logHead.index, 0);
  time.advance(DAY + 3_600_000);
  a.serve('/island/keys.json', { protocol: 'islands/0', id: `${a.origin}/island/keys.json`, owner: a.origin, updated: '2026-10-02T00:00:00Z', items: [] });
  assert.deepEqual(await deliver(), { status: 401, reason: 'sender-paused' });
  const paused = await row();
  assert.deepEqual([paused.history.status, paused.history.pauseReason], ['paused', 'log-rewritten']);
  assert.deepEqual(paused.history.logHead, trusted.history.logHead, 'the log head does not move');
});
