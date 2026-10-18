import assert from 'node:assert/strict';
import { test } from 'node:test';

import { islandSigner } from '../../core/src/index.js';
import { canonicalize, signActivity } from '../../protocol/src/index.js';
import { POLL, snapshotOf } from '../src/poll.js';
import { access, channels, clock, island, network, ownerCall, SEEDS } from './harness.js';

const DAY = 86_400_000;

/** The poll state a holds for `origin`. */
async function pollState(a, origin) {
  const [row] = await a.rows('SELECT poll FROM islands WHERE origin = ?', [origin]);
  return JSON.parse(row?.poll ?? '{}');
}

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
  await runUntil(a, time, async () => (await pollState(a, b.origin)).synced);
  assert.equal(await feedCount(), 120);
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'neighbor.posted'")).length, 0, 'no flood of events on first sync');
  const state = await pollState(a, b.origin);
  assert.equal(state.snapshot, b.json('/island/outbox.json').snapshot);
  assert.equal(state.scan, null);

  // Nothing changed: the next due poll is a single 304.
  time.advance(DAY + 3_600_000);
  const quiet = await a.cron();
  assert.deepEqual([quiet.polled, quiet.verified], [[b.origin], 0]);

  // Not due again yet, so cron leaves it; the owner's "sync now" does not wait.
  assert.deepEqual((await a.cron()).polled, []);
  const owner = ownerCall(a, await team.token(team.claims(time.now())));
  assert.deepEqual((await (await owner('/island/api/poll', {})).json()).polled, [b.origin]);

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

/** a follows b; b has `records` records. */
async function followed(records, options = {}) {
  const net = network();
  const time = clock();
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, name: '甲岛' });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, name: '乙岛', records, ...options });
  await a.store.run('INSERT INTO islands (origin, first_seen, following) VALUES (?, ?, 1)', [b.origin, time.now()]);
  const feed = async () => (await a.rows('SELECT id FROM feed ORDER BY id')).map((row) => row.id);
  const synced = async () => (await pollState(a, b.origin)).synced === true;
  return { net, time, a, b, feed, synced };
}

/** The snapshot digest of a set of activities, as a publisher computes it. @param {any[]} items */
const digestOf = (items) => snapshotOf(items.map((item) => [item.id, canonicalize(item)]));

/** Every item on every page of `target`'s outbox. */
function allItems(target) {
  const items = [];
  for (let page = target.json('/island/outbox.json'); ; page = target.json(new URL(page.next).pathname)) {
    items.push(...page.items);
    if (!page.next) return items;
  }
}

test('pages that do not add up to the head\'s snapshot never count as a complete sync', async () => {
  const { time, a, b, feed } = await followed(120);
  // The oldest page loses one post; the head still claims the full snapshot.
  const oldest = b.json('/island/outbox-1.json');
  oldest.items.shift();
  b.serve('/island/outbox-1.json', oldest);
  await runUntil(a, time, async () => false, 12);
  assert.equal((await feed()).length, 119);
  let state = await pollState(a, b.origin);
  assert.equal(state.synced, false);
  assert.equal(state.snapshot, null, 'the claimed snapshot is never recorded');
  assert.equal(state.problem, 'snapshot-mismatch');
  // Even after the head answers 304 for a while, it is not complete.
  time.advance(DAY);
  await runUntil(a, time, async () => false, 4);
  assert.equal((await pollState(a, b.origin)).synced, false);

  // The publisher serves the page again: the next scan completes.
  await b.republish((list) => list);
  time.advance(DAY);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).synced, 20);
  state = await pollState(a, b.origin);
  assert.equal((await feed()).length, 120);
  assert.equal(state.snapshot, b.json('/island/outbox.json').snapshot);
});

test('an unfinished scan goes on page by page; the head is asked again only after the last page', async () => {
  const { net, time, a, b, synced } = await followed(120);
  const head = `${b.origin}/island/outbox.json`;
  const heads = () => net.count((entry) => entry.url === head);
  await a.cron();
  time.advance(15 * 60_000);
  const after = heads();
  assert.equal(after, 1);
  // Pages behind the head, until the digest of all of them matches.
  await runUntil(a, time, async () => (await pollState(a, b.origin)).scan?.recheck === true, 8);
  assert.equal(heads(), after, 'no head request while the scan is unfinished');
  assert.equal(await synced(), false, 'not complete before the head is checked again');
  await a.cron();
  assert.equal(heads(), after + 1);
  assert.equal(await synced(), true);
});

test('a change between the last page and the head check starts a new scan', async () => {
  const { time, a, b, feed, synced } = await followed(60);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).scan?.recheck === true, 6);
  const first = (await pollState(a, b.origin)).scan.target;
  await b.republish((list) => [...list, { slug: 'late', kind: 'note', date: '2026-10-13', html: '<p>晚到的一条</p>', summary: '晚到的一条' }]);
  await a.cron();
  time.advance(15 * 60_000);
  const state = await pollState(a, b.origin);
  assert.equal(state.synced, false, 'the earlier snapshot is not recorded as complete');
  assert.notEqual(state.scan?.target ?? null, first);
  await runUntil(a, time, synced, 8);
  assert.equal((await feed()).length, 61);
  assert.equal((await pollState(a, b.origin)).snapshot, b.json('/island/outbox.json').snapshot);
  // The first complete read set the baseline, so the late post was news.
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'neighbor.posted'")).length, 1);
});

test('a withdrawal leaves a tombstone: an old signed copy of the post cannot bring it back', async () => {
  const { time, a, b, feed, synced } = await followed(3);
  await runUntil(a, time, synced, 4);
  const r2 = `${b.origin}/records/r2/`;
  const oldPost = allItems(b).find((item) => item.id === r2);
  await b.republish((list) => list.map((r) => (r.slug === 'r2' ? { ...r, withdrawn: '2026-10-10' } : r)));
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await synced()) && !(await feed()).includes(r2), 6);
  assert.deepEqual(await feed(), [`${b.origin}/records/r1/`, `${b.origin}/records/r3/`]);
  assert.equal((await a.rows('SELECT target FROM tombstones'))[0].target, r2);

  // The old post comes back next to the withdrawal, with a correct snapshot.
  const page = b.json('/island/outbox.json');
  page.items.push(oldPost);
  page.snapshot = await digestOf(page.items);
  b.serve('/island/outbox.json', page);
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.equal((await feed()).includes(r2), false, 'still withdrawn');
});

test('a withdrawal read before its post still keeps the post out', async () => {
  const { time, a, b, feed, synced } = await followed(2);
  const r2 = `${b.origin}/records/r2/`;
  const oldPost = allItems(b).find((item) => item.id === r2);
  await b.republish((list) => list.map((r) => (r.slug === 'r2' ? { ...r, withdrawn: '2026-10-10' } : r)));
  await runUntil(a, time, synced, 4);
  assert.equal((await a.rows('SELECT target FROM tombstones'))[0].target, r2, 'a valid withdrawal of a post never seen');
  const page = b.json('/island/outbox.json');
  page.items.push(oldPost);
  page.snapshot = await digestOf(page.items);
  b.serve('/island/outbox.json', page);
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.deepEqual(await feed(), [`${b.origin}/records/r1/`]);
});

test('invalid or foreign withdrawals leave no tombstone; a later version comes back', async () => {
  const { time, a, b, feed, synced } = await followed(2);
  await runUntil(a, time, synced, 4);
  const signer = await b.signer();
  const sign = (/** @type {Record<string, any>} */ fields) => signActivity({ type: 'delete', actor: b.origin, published: '2026-10-10T00:00:00Z', to: 'public', ...fields }, { keyId: signer.keyId, privateKey: signer.privateKey });
  // Someone else's post: b cannot withdraw it.
  const foreign = await sign({ id: `${b.origin}/island/d/1`, object: { of: 'https://c.example/records/x/' } });
  // b's own post, but the signature does not hold.
  const forged = await sign({ id: `${b.origin}/records/r1/#withdrawn`, object: { of: `${b.origin}/records/r1/` } });
  forged.proof = { ...forged.proof, value: `${forged.proof.value.slice(0, -4)}AAAA` };
  const page = b.json('/island/outbox.json');
  page.items.push(foreign, forged);
  page.snapshot = await digestOf(allItems(b).filter((i) => !page.items.includes(i)).concat(page.items));
  b.serve('/island/outbox.json', page);
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.equal((await a.rows('SELECT * FROM tombstones')).length, 0);
  assert.equal((await feed()).length, 2);

  // A real withdrawal, then the author publishes the post again with a later version.
  await b.republish((list) => list.map((r) => (r.slug === 'r2' ? { ...r, withdrawn: '2026-10-10' } : r)));
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await synced()) && (await feed()).length === 1, 6);
  await b.republish((list) => list.map((r) => (r.slug === 'r2' ? { ...r, withdrawn: undefined, updated: '2026-10-12' } : r)));
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await feed()).length === 2, 6);
  assert.equal((await a.rows('SELECT * FROM tombstones')).length, 0, 'the tombstone gave way to the later version');
});

test('budget: running out inside an island keeps everything finished before it', async () => {
  const net = network();
  const time = clock();
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a });
  const neighbors = [];
  for (let i = 0; i < 9; i += 1) {
    const n = await island({ net, time, origin: `https://m${i}.example`, seed: (0x70 + i).toString(16).repeat(32), records: 1, keyLog: i === 8 ? [] : null });
    neighbors.push(n);
    await a.store.run('INSERT INTO islands (origin, first_seen, following, poll) VALUES (?, ?, 1, ?)', [n.origin, time.now(), JSON.stringify({ nextAt: i })]);
  }
  // The last answers its manifest, key log and outbox through three same-origin redirects each.
  const original = net.hosts.get('m8.example');
  net.route('m8.example', (request) => {
    const url = new URL(request.url);
    const hop = Number(url.searchParams.get('hop') ?? 0);
    if (['/.well-known/island.json', '/island/keys.json', '/island/outbox.json'].includes(url.pathname) && hop < 3) {
      return new Response(null, { status: 307, headers: { location: `${url.pathname}?hop=${hop + 1}` } });
    }
    return original(request);
  });

  const before = net.log.length;
  const first = await a.cron();
  assert.ok(first.used <= 45, `${first.used} subrequests`);
  assert.ok(net.log.length - before <= 45);
  assert.equal(first.stopped, true);
  assert.deepEqual(first.polled, neighbors.slice(0, 8).map((n) => n.origin));
  assert.equal((await a.rows('SELECT * FROM feed')).length, 8, 'the eight finished islands are saved');
  assert.equal((await a.rows('SELECT * FROM islands WHERE history IS NOT NULL')).length, 8);
  assert.equal((await pollState(a, 'https://m8.example')).nextAt, 8, 'the unfinished island keeps its place');

  time.advance(15 * 60_000);
  const second = await a.cron();
  assert.ok(second.used <= 45, `${second.used} subrequests`);
  assert.equal(second.polled[0], 'https://m8.example');
  assert.equal((await a.rows('SELECT * FROM feed')).length, 9);
});

/** Signs an activity as `target` (its k1, or another key). */
async function signedBy(target, fields, signer = null) {
  const key = signer ?? (await target.signer());
  return signActivity({ actor: target.origin, to: 'public', ...fields }, { keyId: key.keyId, privateKey: key.privateKey });
}

/** Serves `items` as b's whole outbox: one head page with the right snapshot. */
async function serveOutbox(target, items) {
  const page = { protocol: 'islands/0', id: `${target.origin}/island/outbox.json`, owner: target.origin, updated: '2026-10-15T00:00:00Z', items, snapshot: await digestOf(items) };
  target.serve('/island/outbox.json', page);
  return page;
}

test('withdrawal times are compared as instants, not as RFC 3339 text', async () => {
  const { time, a, b, feed } = await followed(1);
  const template = allItems(b).find((item) => item.type === 'post');
  const id = `${b.origin}/records/tz/`;
  // 01:00 at +02:00 is 23:00 the day before in UTC; the withdrawal comes an hour later.
  const post = await signedBy(b, { id, type: 'post', published: '2026-10-14T01:00:00+02:00', object: { ...template.object, url: id } });
  const withdrawal = await signedBy(b, { id: `${id}#withdrawn`, type: 'delete', published: '2026-10-14T00:00:00Z', object: { of: id } });
  const until = async (/** @type {any} */ page) => runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);

  // The post exists; the later withdrawal removes it.
  await until(await serveOutbox(b, [post]));
  assert.deepEqual(await feed(), [id]);
  time.advance(DAY + 3_600_000);
  await until(await serveOutbox(b, [withdrawal]));
  assert.deepEqual(await feed(), [], 'a later withdrawal applies even though "…Z" sorts before "…+02:00"');
  assert.equal((await a.rows('SELECT deleted FROM tombstones'))[0].deleted, Date.parse('2026-10-14T00:00:00Z'));

  // The old post's signed copy next to the withdrawal stays out.
  time.advance(DAY + 3_600_000);
  await until(await serveOutbox(b, [withdrawal, post]));
  assert.deepEqual(await feed(), []);

  // So does a copy at the same instant written another way (offset, fractions).
  const same = await signedBy(b, { id, type: 'post', published: '2026-10-14T01:00:00+02:00', updated: '2026-10-14T02:00:00.000+02:00', object: { ...template.object, url: id } });
  time.advance(DAY + 3_600_000);
  await until(await serveOutbox(b, [withdrawal, same]));
  assert.deepEqual(await feed(), [], 'the same instant as the withdrawal is not later');

  // A version that is really later brings it back.
  const later = await signedBy(b, { id, type: 'post', published: '2026-10-14T01:00:00+02:00', updated: '2026-10-14T00:00:00.5-00:30', object: { ...template.object, url: id } });
  time.advance(DAY + 3_600_000);
  await until(await serveOutbox(b, [withdrawal, later]));
  assert.deepEqual(await feed(), [id]);
  assert.equal((await a.rows('SELECT * FROM tombstones')).length, 0);
});

test('a withdrawal read first, and a post signed with an offset, still stay withdrawn', async () => {
  const { time, a, b, feed } = await followed(1);
  const template = allItems(b).find((item) => item.type === 'post');
  const id = `${b.origin}/records/tz/`;
  const post = await signedBy(b, { id, type: 'post', published: '2026-10-14T01:00:00+02:00', object: { ...template.object, url: id } });
  const withdrawal = await signedBy(b, { id: `${id}#withdrawn`, type: 'delete', published: '2026-10-14T00:00:00Z', object: { of: id } });
  let page = await serveOutbox(b, [withdrawal]);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.equal((await a.rows('SELECT * FROM tombstones')).length, 1);
  time.advance(DAY + 3_600_000);
  page = await serveOutbox(b, [withdrawal, post]);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.deepEqual(await feed(), []);
  assert.equal((await a.rows('SELECT * FROM tombstones')).length, 1);
});

test('items with bad signatures are checked once, so the good ones behind them get read', async () => {
  const { time, a, b, feed } = await followed(1);
  const template = allItems(b).find((item) => item.type === 'post');
  const posts = [];
  for (let i = 0; i < 50; i += 1) {
    const id = `${b.origin}/records/p${i}/`;
    posts.push(await signedBy(b, { id, type: 'post', published: `2026-10-${String(10 + Math.floor(i / 10)).padStart(2, '0')}T0${i % 10}:00:00Z`, object: { ...template.object, url: id } }));
  }
  // The first 40 on the page carry a broken signature (still well-formed).
  const broken = posts.map((post, i) => (i < 40 ? { ...post, proof: { ...post.proof, value: `${post.proof.value.slice(0, -6)}AAAAAA` } } : post));
  const page = await serveOutbox(b, broken);
  const reports = await runUntil(a, time, async () => (await feed()).length === 10, 4);
  assert.ok(reports.every((report) => report.verified <= POLL.verifyLimit));
  assert.equal(reports.length, 2, 'one run for the 40 bad items, the next reads the 10 good ones');
  assert.equal(reports[1].verified, 10, 'the bad ones are not checked again');
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 4);
  assert.equal((await pollState(a, b.origin)).synced, true);

  // Fixed by the publisher: the corrected items are new versions and are read.
  time.advance(DAY + 3_600_000);
  const fixed = await serveOutbox(b, posts);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === fixed.snapshot, 6);
  assert.equal((await feed()).length, 50);
});

test('bad items do not block the next page either', async () => {
  const { time, a, b, feed } = await followed(1);
  const template = allItems(b).find((item) => item.type === 'post');
  const make = async (/** @type {number} */ i) => {
    const id = `${b.origin}/records/q${i}/`;
    return signedBy(b, { id, type: 'post', published: `2026-09-${String(1 + Math.floor(i / 10)).padStart(2, '0')}T0${i % 10}:00:00Z`, object: { ...template.object, url: id } });
  };
  const older = [];
  for (let i = 0; i < 5; i += 1) older.push(await make(i));
  const newer = [];
  for (let i = 10; i < 55; i += 1) {
    const post = await make(i);
    newer.push({ ...post, proof: { ...post.proof, value: `${post.proof.value.slice(0, -6)}AAAAAA` } });
  }
  const second = { protocol: 'islands/0', id: `${b.origin}/island/outbox-1.json`, owner: b.origin, updated: '2026-10-15T00:00:00Z', items: older };
  const head = { protocol: 'islands/0', id: `${b.origin}/island/outbox.json`, owner: b.origin, updated: '2026-10-15T00:00:00Z', items: newer, next: second.id, snapshot: await digestOf([...newer, ...older]) };
  b.serve('/island/outbox-1.json', second);
  b.serve('/island/outbox.json', head);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === head.snapshot, 8);
  assert.equal((await feed()).length, 5, 'all good items on the next page were read');
});

test('a rejection is checked again when the key history changes', async () => {
  const net = network();
  const time = clock();
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, keyLog: [] });
  await a.store.run('INSERT INTO islands (origin, first_seen, following) VALUES (?, ?, 1)', [b.origin, time.now()]);
  const template = allItems(b).find((item) => item.type === 'post');
  // Signed with a second key a does not know yet.
  const k2 = await islandSigner({ ISLAND_SIGNING_KEY: 'f6'.repeat(32) }, { origin: b.origin, keyName: 'k2' });
  const id = `${b.origin}/records/k2/`;
  const post = await signedBy(b, { id, type: 'post', published: '2026-10-14T00:00:00Z', object: { ...template.object, url: id } }, k2);
  const page = await serveOutbox(b, [post]);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === page.snapshot, 6);
  assert.equal((await a.rows('SELECT * FROM feed')).length, 0);
  assert.equal((await a.rows('SELECT * FROM rejected')).length, 1);

  // b's key log now adds k2, signed with k1; a reads it with the next manifest.
  const k1 = await b.signer();
  const entry = await signActivity(
    { id: `${b.origin}/island/keys/1`, type: 'key', actor: b.origin, published: '2026-10-14T00:00:00Z', to: 'public', object: { add: { id: k2.keyId, type: 'Ed25519', publicKey: k2.publicKey } } },
    { keyId: k1.keyId, privateKey: k1.privateKey },
  );
  b.serve('/island/keys.json', { protocol: 'islands/0', id: `${b.origin}/island/keys.json`, owner: b.origin, updated: '2026-10-15T00:00:00Z', items: [entry] });
  // A new item makes the head change, so the page is read again.
  const id2 = `${b.origin}/records/k1/`;
  const next = await serveOutbox(b, [post, await signedBy(b, { id: id2, type: 'post', published: '2026-10-15T00:00:00Z', object: { ...template.object, url: id2 } })]);
  time.advance(DAY + 3_600_000);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).snapshot === next.snapshot, 6);
  assert.deepEqual((await a.rows('SELECT id FROM feed ORDER BY id')).map((r) => r.id), [id2, id]);
});

/** b's second key k2, added by a key log entry signed with k1, and a manifest listing both. */
async function rotateToK2(b) {
  const k1 = await b.signer();
  const k2 = await islandSigner({ ISLAND_SIGNING_KEY: 'f6'.repeat(32) }, { origin: b.origin, keyName: 'k2' });
  const entry = await signActivity(
    { id: `${b.origin}/island/keys/1`, type: 'key', actor: b.origin, published: '2026-10-14T00:00:00Z', to: 'public', object: { add: { id: k2.keyId, type: 'Ed25519', publicKey: k2.publicKey } } },
    { keyId: k1.keyId, privateKey: k1.privateKey },
  );
  return {
    k2,
    entry,
    publish() {
      b.serve('/island/keys.json', { protocol: 'islands/0', id: `${b.origin}/island/keys.json`, owner: b.origin, updated: '2026-10-15T00:00:00Z', items: [entry] });
      const manifest = b.json('/.well-known/island.json');
      b.serve('/.well-known/island.json', { ...manifest, keys: [...manifest.keys, { id: k2.keyId, type: 'Ed25519', publicKey: k2.publicKey }] });
    },
  };
}

test('after a key rotation, items rejected under the old history are read, though the outbox did not change (scan waiting for its head check)', async () => {
  const net = network();
  const time = clock();
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, keyLog: [], records: 1 });
  await a.store.run('INSERT INTO islands (origin, first_seen, following) VALUES (?, ?, 1)', [b.origin, time.now()]);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).synced, 4);

  // b rotates properly: log entry, manifest with k2, and an outbox with the key hint and a k2 post.
  const rotation = await rotateToK2(b);
  rotation.publish();
  const template = allItems(b).find((item) => item.type === 'post');
  const id = `${b.origin}/records/after-rotation/`;
  const post = await signedBy(b, { id, type: 'post', published: '2026-10-15T00:00:00Z', object: { ...template.object, url: id } }, rotation.k2);
  const page = await serveOutbox(b, [template, rotation.entry, post]);

  // a's cached manifest is still fresh: the k2 post is rejected for now, the key hint asks for a manifest read.
  const owner = ownerCall(a, await team.token(team.claims(time.now())));
  const sync = async () => (await owner('/island/api/poll', {})).json();
  const first = await sync();
  assert.ok(first.verified <= POLL.verifyLimit);
  assert.equal((await a.rows('SELECT * FROM feed WHERE id = ?', [id])).length, 0);
  assert.equal((await pollState(a, b.origin)).scan?.recheck, true, 'the digest matched; waiting for the head check');

  // The next sync reads the log and trusts k2. The outbox is unchanged (304), yet the post must be read.
  const reports = [];
  for (let i = 0; i < 4 && !(await a.rows('SELECT * FROM feed WHERE id = ?', [id])).length; i += 1) reports.push(await sync());
  assert.equal((await a.rows('SELECT * FROM feed WHERE id = ?', [id])).length, 1, `reports: ${JSON.stringify(reports)}`);
  assert.ok(reports.every((report) => report.verified <= POLL.verifyLimit));
  for (let i = 0; i < 3; i += 1) await sync();
  const state = await pollState(a, b.origin);
  assert.deepEqual([state.synced, state.snapshot === page.snapshot, state.scan], [true, true, null]);
});

test('after a key rotation, items rejected under the old history are read, though the outbox did not change (completed sync)', async () => {
  const { net, time, a, b, feed } = await followed(1, { keyLog: [] });
  const rotation = await rotateToK2(b);
  const template = allItems(b).find((item) => item.type === 'post');
  const id = `${b.origin}/records/early-k2/`;
  // b posts with k2 before publishing the key: a cannot verify it yet.
  const post = await signedBy(b, { id, type: 'post', published: '2026-10-15T00:00:00Z', object: { ...template.object, url: id } }, rotation.k2);
  const page = await serveOutbox(b, [template, post]);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).synced, 6);
  assert.deepEqual(await feed(), [template.id]);
  assert.equal((await a.rows('SELECT * FROM rejected')).length, 1);

  // Now b publishes the key log and manifest; the outbox stays byte for byte the same.
  rotation.publish();
  const outboxReads = () => net.count((entry) => entry.url === `${b.origin}/island/outbox.json`);
  const before = outboxReads();
  time.advance(DAY + 3_600_000);
  const reports = await runUntil(a, time, async () => (await feed()).includes(id), 4);
  assert.deepEqual((await feed()).sort(), [template.id, id].sort());
  assert.ok(reports.every((report) => report.verified <= POLL.verifyLimit));
  assert.ok(outboxReads() > before);
  await runUntil(a, time, async () => (await pollState(a, b.origin)).synced, 4);
  assert.equal((await pollState(a, b.origin)).snapshot, page.snapshot);
});
