import assert from 'node:assert/strict';
import { test } from 'node:test';

import { POLL } from '../src/poll.js';
import { access, channels, clock, island, network, ownerCall, SEEDS } from './harness.js';

const DAY = 86_400_000;

/** Runs cron until `done()` or `max` runs, 15 minutes apart. Returns the reports. */
async function runUntil(target, time, done, max = 40) {
  const reports = [];
  for (let i = 0; i < max && !(await done()); i += 1) {
    reports.push(await target.cron());
    time.advance(15 * 60_000);
  }
  return reports;
}

test('a first sync reads every page quietly; later posts, edits and withdrawals arrive', async () => {
  const net = network();
  const time = clock();
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, name: '甲岛' });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, name: '乙岛', records: 120 });
  await ownerCall(a, await team.token(team.claims(time.now())))('/island/api/follow', { origin: b.origin });

  const feedCount = async () => (await a.rows('SELECT COUNT(*) AS n FROM feed'))[0].n;
  await runUntil(a, time, async () => (await feedCount()) === 120);
  assert.equal(await feedCount(), 120);
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'neighbor.posted'")).length, 0, 'no flood of events on first sync');
  const [state] = await a.rows("SELECT poll FROM islands WHERE origin = 'https://b.example'");
  assert.equal(JSON.parse(state.poll).synced, true);

  // Nothing changed: the next due poll is a single 304.
  time.advance(DAY + 3_600_000);
  const quiet = await a.cron();
  assert.deepEqual([quiet.polled, quiet.verified], [[b.origin], 0]);

  // A new record.
  await b.republish((list) => [...list, { slug: 'fresh', kind: 'note', date: '2026-10-15', html: '<p>新的一条</p>', summary: '新的一条' }]);
  time.advance(DAY + 3_600_000);
  await a.cron();
  assert.equal(await feedCount(), 121);
  const posted = await a.rows("SELECT data FROM events WHERE type = 'neighbor.posted'");
  assert.equal(posted.length, 1);
  assert.match(JSON.parse(posted[0].data).summary, /乙岛发了新记录：新的一条/);

  // An edit to the oldest record: it moves to the head with a later version.
  await b.republish((list) => list.map((r) => (r.slug === 'r1' ? { ...r, title: '改过的标题', updated: '2026-10-16' } : r)));
  time.advance(3_600_000 + 15 * 60_000);
  await runUntil(a, time, async () => {
    const [row] = await a.rows("SELECT activity FROM feed WHERE id = 'https://b.example/records/r1/'");
    return JSON.parse(row.activity).object.title === '改过的标题';
  }, 8);
  const [edited] = await a.rows("SELECT activity FROM feed WHERE id = 'https://b.example/records/r1/'");
  assert.equal(JSON.parse(edited.activity).object.title, '改过的标题');
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'neighbor.posted'")).length, 1, 'an edit is not a new post');

  // A withdrawal removes the record from the feed.
  await b.republish((list) => list.map((r) => (r.slug === 'r2' ? { ...r, withdrawn: '2026-10-17' } : r)));
  time.advance(3_600_000 + 15 * 60_000);
  await runUntil(a, time, async () => (await feedCount()) === 120, 8);
  assert.equal((await a.rows("SELECT * FROM feed WHERE id = 'https://b.example/records/r2/'")).length, 0);
});

test('budget: 40 neighbors syncing for the first time, with pages, redirects and notifications', async () => {
  const net = network();
  const time = clock();
  const sent = channels(net);
  const team = await access(net);
  const notify = { timezone: 'UTC', rules: { 'neighbor.posted': 'now' }, channels: [{ type: 'telegram', chatId: '1' }] };
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, notify, env: { TELEGRAM_BOT_TOKEN: 't' } });
  const owner = ownerCall(a, await team.token(team.claims(time.now())));
  const neighbors = [];
  for (let i = 0; i < 40; i += 1) {
    const origin = `https://n${i}.example`;
    const neighbor = await island({ net, time, origin, seed: (0x60 + i).toString(16).repeat(32), records: i % 4 === 0 ? 60 : 5 });
    neighbors.push(neighbor);
    if (i % 5 === 0) {
      // Every fifth neighbor answers its outbox through a same-origin redirect.
      const original = net.hosts.get(new URL(origin).host);
      net.route(new URL(origin).host, (request) => {
        const url = new URL(request.url);
        return url.pathname === '/island/outbox.json' && !url.search ? new Response(null, { status: 307, headers: { location: '/island/outbox.json?v=1' } }) : original(request);
      });
    }
  }
  // Following directly in the store: the owner API would send 40 follows first.
  for (const n of neighbors) await a.store.run('INSERT INTO islands (origin, first_seen, following) VALUES (?, ?, 1)', [n.origin, time.now()]);
  void owner;

  const expected = neighbors.reduce((sum, _n, i) => sum + (i % 4 === 0 ? 60 : 5), 0);
  const feed = async () => (await a.rows('SELECT COUNT(*) AS n FROM feed'))[0].n;
  let runs = 0;
  for (; runs < 60 && (await feed()) < expected; runs += 1) {
    const before = net.log.length;
    const report = await a.cron();
    const fetched = net.log.length - before;
    assert.ok(report.used <= 45, `run ${runs + 1}: ${report.used} subrequests (store calls and fetches)`);
    assert.ok(fetched <= 45, `run ${runs + 1}: ${fetched} fetches`);
    time.advance(15 * 60_000);
  }
  assert.equal(await feed(), expected, `all synced after ${runs} runs`);
  // Signature checks per run (CPU) bound a first sync, not requests: about 750 posts / 40 per run.
  assert.ok(runs <= Math.ceil(expected / POLL.verifyLimit) + 2, `took ${runs} runs`);

  // Now every neighbor posts once; notifications go out within the same budget.
  for (const n of neighbors) await n.republish((list) => [...list, { slug: 'news', kind: 'note', date: '2026-10-15', html: '<p>新消息</p>', summary: '新消息' }]);
  time.advance(DAY + 3_600_000);
  for (let i = 0; i < 10 && (await feed()) < expected + 40; i += 1) {
    const report = await a.cron();
    assert.ok(report.used <= 45);
    time.advance(15 * 60_000);
  }
  assert.equal(await feed(), expected + 40);
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'neighbor.posted' AND sent IS NULL")).length, 0, 'every event was sent');
  assert.ok(sent.length >= 4, 'notifications were batched, up to 10 events per message');
});

test('friends lists tell who follows us and who is a friend of a friend', async () => {
  const net = network();
  const time = clock();
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, friends: [{ id: 'https://b.example', name: '乙岛' }] });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, friends: [{ id: 'https://a.example' }, { id: 'https://c.example' }] });
  const c = await island({ net, time, origin: 'https://c.example', seed: SEEDS.c });
  void team;
  await a.cron();
  const [row] = await a.rows("SELECT follower, friends FROM islands WHERE origin = 'https://b.example'");
  assert.equal(row.follower, 1, 'b lists a in its friends.json');
  assert.deepEqual(JSON.parse(row.friends), ['https://a.example', 'https://c.example']);
  // c is a friend of a friend: its message lands in the inbox, but only for the digest.
  const { importPrivateSeed, signActivity } = await import('../../protocol/src/index.js');
  const privateKey = await importPrivateSeed(Uint8Array.from(SEEDS.c.match(/../g), (x) => parseInt(x, 16)));
  const activity = await signActivity({ id: `${c.origin}/island/a/1`, type: 'message', actor: c.origin, published: new Date(time.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), to: [a.origin], object: { text: '你好' } }, { keyId: `${c.origin}#k1`, privateKey });
  await a.store.run("UPDATE islands SET following = 1 WHERE origin = 'https://b.example'");
  const response = await a.request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(activity) });
  assert.equal(response.status, 202);
  assert.equal((await a.rows('SELECT folder FROM received'))[0].folder, 'inbox');
  assert.equal((await a.rows("SELECT mode FROM events WHERE type = 'message.received'"))[0].mode, 'digest');
});
