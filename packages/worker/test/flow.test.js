import assert from 'node:assert/strict';
import { test } from 'node:test';

import { access, channels, clock, island, network, ownerCall, SEEDS } from './harness.js';

const NOTIFY = { timezone: 'Asia/Shanghai', quietHours: ['23:00', '08:00'], digestAt: '21:00', channels: [{ type: 'telegram', chatId: '42' }] };

async function twoIslands() {
  const net = network();
  const time = clock(Date.parse('2026-10-14T04:00:00Z')); // 12:00 in Shanghai
  const sent = channels(net);
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, name: '甲岛', notify: NOTIFY, env: { TELEGRAM_BOT_TOKEN: 't' } });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, name: '乙岛', notify: NOTIFY, env: { TELEGRAM_BOT_TOKEN: 't' } });
  const token = await team.token(team.claims(time.now()));
  return { net, time, sent, team, a, b, asA: ownerCall(a, token), asB: ownerCall(b, token) };
}

test('two islands follow each other and exchange all four directed activities', async () => {
  const { sent, a, b, asA, asB } = await twoIslands();

  const followAB = await (await asA('/island/api/follow', { origin: b.origin })).json();
  assert.equal(followAB.status, 'delivered', JSON.stringify(followAB));
  assert.equal(await (await asB('/island/api/follow', { origin: a.origin })).json().then((r) => r.status), 'delivered');

  const message = await (await asA('/island/api/send', { type: 'message', to: b.origin, text: '看了你那篇桥的照片', inReplyTo: `${b.origin}/records/r1/`, public: true })).json();
  assert.equal(message.status, 'delivered', JSON.stringify(message));
  for (const type of ['visit', 'water']) {
    assert.equal((await (await asA('/island/api/send', { type, to: b.origin })).json()).status, 'delivered');
  }

  // A's follow came before B followed back, so it waits among strangers; the rest come from a neighbor.
  const strangers = await (await asB('/island/api/inbox?folder=strangers')).json();
  assert.deepEqual(strangers.items.map((item) => item.type), ['follow']);
  const inbox = await (await asB('/island/api/inbox')).json();
  assert.deepEqual(inbox.items.map((item) => item.type).sort(), ['message', 'visit', 'water']);
  assert.ok(inbox.items.every((item) => item.folder === 'inbox' && item.name === '甲岛'));
  assert.equal(inbox.items.find((item) => item.type === 'message').activity.object.text, '看了你那篇桥的照片');

  // The message from a neighbor is sent right away; visits, water and follows wait for the digest.
  const telegram = sent.filter((entry) => entry.channel === 'telegram').map((entry) => entry.body.text);
  assert.ok(telegram.some((text) => text.includes('甲岛给你留言：看了你那篇桥的照片')), JSON.stringify(telegram));
  assert.ok(!telegram.some((text) => text.includes('来拜访过')));
  const islands = await (await asB('/island/api/islands')).json();
  assert.deepEqual(islands.items.map((item) => [item.origin, item.following, item.follower]), [[a.origin, true, true]]);
});
