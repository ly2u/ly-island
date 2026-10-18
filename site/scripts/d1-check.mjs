// The island service on a real local D1 (workerd, through Wrangler's
// getPlatformProxy), for what Node's SQLite in the unit tests cannot show:
// D1's own limits (100 bound parameters per statement) and its batches as
// transactions, under concurrent requests.
//
//   node scripts/d1-check.mjs        (CI runs it; needs npm ci here)
//
// Scenarios, each on a fresh database:
// - a digest of 200 events is sent once and confirmed;
// - concurrent copies of one delivery: one letter, one event;
// - concurrent different deliveries stop at the hourly quota;
// - a 120-record neighbor syncs to its verified snapshot (page cache, json_each);
// - a letter held for a paused recipient is released by retrust (RETURNING);
// - concurrent requests to send a failed letter again create one new letter.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPlatformProxy } from 'wrangler';

import { importPrivateSeed, signActivity } from '../../packages/protocol/src/index.js';
import { budget } from '../../packages/worker/src/budget.js';
import { checkPolicy, flushDigest } from '../../packages/worker/src/notify.js';
import { migrate } from '../../packages/worker/src/schema.js';
import { d1Store } from '../../packages/worker/src/store-d1.js';
import { stringsFor } from '../../packages/worker/src/strings.js';
import { access, clock, island, network, ownerCall, SEEDS } from '../../packages/worker/test/harness.js';

const dir = mkdtempSync(join(tmpdir(), 'island-d1-'));
const names = ['digest', 'same', 'quota', 'poll', 'held', 'resend'];
writeFileSync(join(dir, 'wrangler.json'), JSON.stringify({
  name: 'island-d1-check',
  compatibility_date: '2026-09-01',
  d1_databases: names.map((name) => ({ binding: name.toUpperCase(), database_name: `d1-check-${name}`, database_id: `d1-check-${name}` })),
}));
const proxy = await getPlatformProxy({ configPath: join(dir, 'wrangler.json'), persist: { path: join(dir, 'state') } });
/** @type {string[]} */
const problems = [];
/** @param {string} what @param {boolean} ok @param {unknown} [detail] */
function expect(what, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}${detail === '' ? '' : `: ${String(detail)}`}`);
  if (!ok) problems.push(`${what} ${String(detail)}`);
}
const d1 = (/** @type {string} */ name) => d1Store(proxy.env[name.toUpperCase()]);
const seedBytes = (/** @type {string} */ hex) => Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));

try {
  // D1 itself refuses more than 100 bound parameters: the limit the unit tests mirror.
  {
    const store = d1('digest');
    await migrate(store);
    let refused = false;
    try {
      await store.all(`SELECT ${Array.from({ length: 101 }, () => '?').join(', ')}`, Array.from({ length: 101 }, (_, i) => i));
    } catch {
      refused = true;
    }
    expect('D1 refuses 101 bound parameters', refused);

    // A digest of 200 events.
    let time = Date.parse('2026-10-14T12:00:00Z');
    const posted = [];
    const ctx = {
      store,
      now: () => time,
      policy: checkPolicy({ timezone: 'UTC', digestAt: '21:00', channels: [{ type: 'webhook' }] }),
      fetch: async (/** @type {string} */ url, /** @type {RequestInit} */ init) => (posted.push(JSON.parse(String(init.body))), new Response(null, { status: 204 })),
      budget: budget(45),
      env: { WEBHOOK_URL: 'https://hooks.example/in' },
      strings: stringsFor('en'),
    };
    const inserts = Array.from({ length: 200 }, (_, i) => /** @type {[string, unknown[]]} */ ([
      'INSERT INTO events (type, at, mode, data) VALUES (?, ?, ?, ?)',
      ['visit.received', time, 'digest', JSON.stringify({ type: 'visit.received', at: new Date(time).toISOString(), summary: `visitor ${i}` })],
    ]));
    await store.batch(inserts);
    time = Date.parse('2026-10-14T21:05:00Z');
    const count = await flushDigest(ctx);
    expect('digest of 200 events sent', count === 200 && posted.length === 1, `${count} events, ${posted.length} messages`);
    const left = await store.all('SELECT COUNT(*) AS n FROM events WHERE sent IS NULL');
    expect('all 200 confirmed', left[0].n === 0, left[0].n);
    time = Date.parse('2026-10-14T21:20:00Z');
    expect('not sent again', (await flushDigest({ ...ctx, budget: budget(45) })) === 0 && posted.length === 1);
  }

  // Concurrent deliveries into an inbox on D1.
  for (const scenario of ['same', 'quota']) {
    const net = network();
    const time = clock();
    const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a });
    const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, store: d1(scenario) });
    const privateKey = await importPrivateSeed(seedBytes(SEEDS.a));
    const sign = () => signActivity({ id: `${a.origin}/island/a/${crypto.randomUUID()}`, type: 'message', actor: a.origin, published: new Date(time.now()).toISOString().replace(/\.\d{3}Z$/, 'Z'), to: [b.origin], object: { text: 'hello' } }, { keyId: `${a.origin}#k1`, privateKey });
    const deliver = (/** @type {unknown} */ activity) => b.request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(activity) });
    await deliver(await sign());
    for (const table of ['received', 'seen', 'rate', 'events']) await b.store.run(`DELETE FROM ${table}`);
    if (scenario === 'same') {
      const activity = await sign();
      const responses = await Promise.all(Array.from({ length: 12 }, () => deliver(activity)));
      const reasons = await Promise.all(responses.map(async (r) => (await r.json()).reason));
      const letters = (await b.rows('SELECT COUNT(*) AS n FROM received'))[0].n;
      const events = (await b.rows('SELECT COUNT(*) AS n FROM events'))[0].n;
      expect('D1: 12 concurrent copies, one accepted', reasons.filter((r) => r === 'accepted').length === 1, reasons.join(' '));
      expect('D1: one letter and one event', letters === 1 && events === 1, `${letters} letters, ${events} events`);
    } else {
      const activities = await Promise.all(Array.from({ length: 40 }, () => sign()));
      const statuses = (await Promise.all(activities.map((activity) => deliver(activity)))).map((r) => r.status);
      const accepted = statuses.filter((s) => s === 202).length;
      const letters = (await b.rows('SELECT COUNT(*) AS n FROM received'))[0].n;
      expect('D1: 40 concurrent deliveries stop at the quota of 15', accepted === 15 && letters === 15, `${accepted} accepted, ${letters} letters`);
    }
  }

  // A neighbor with 120 records syncs to its verified snapshot, with a on D1.
  {
    const net = network();
    const time = clock();
    const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, store: d1('poll') });
    const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b, records: 120 });
    await a.store.run('INSERT INTO islands (origin, first_seen, following) VALUES (?, ?, 1)', [b.origin, time.now()]);
    let runs = 0;
    let state = {};
    for (; runs < 20 && !state.synced; runs += 1) {
      const report = await a.cron();
      if (report.used > 45) problems.push(`D1 poll run ${runs + 1}: ${report.used} subrequests`);
      time.advance(15 * 60_000);
      state = JSON.parse((await a.rows('SELECT poll FROM islands WHERE origin = ?', [b.origin]))[0].poll ?? '{}');
    }
    const feed = (await a.rows('SELECT COUNT(*) AS n FROM feed'))[0].n;
    expect('D1: 120 records synced to the verified snapshot', state.synced === true && feed === 120 && state.snapshot === b.json('/island/outbox.json').snapshot, `${feed} after ${runs} runs`);
  }

  // A letter held for a paused recipient, released by retrust.
  {
    const net = network();
    const time = clock();
    const team = await access(net);
    const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, store: d1('held') });
    const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b });
    const message = { type: 'message', to: b.origin, text: 'hello' };
    await ownerCall(a, await team.token(team.claims(time.now())))('/island/api/send', message);
    time.advance(25 * 3_600_000);
    await b.rekey('e5'.repeat(32));
    const owner = ownerCall(a, await team.token(team.claims(time.now())));
    const held = await (await owner('/island/api/send', message)).json();
    const released = await (await owner('/island/api/islands', { origin: b.origin, action: 'retrust' })).json();
    await a.cron();
    const statuses = (await a.rows('SELECT status FROM sent ORDER BY created')).map((r) => r.status);
    expect('D1: held for a paused recipient, released by retrust', held.status === 'held' && released.released === 1 && statuses.join() === 'delivered,delivered', `${held.status}, released ${released.released}, ${statuses.join()}`);
  }

  // Concurrent "send again" of one failed letter: one new letter.
  {
    const net = network();
    const time = clock();
    const team = await access(net);
    const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, store: d1('resend') });
    const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b });
    const original = net.hosts.get('b.example');
    let refuse = true;
    net.route('b.example', (request) => (new URL(request.url).pathname === '/island/inbox' && refuse ? new Response(null, { status: 400 }) : original(request)));
    const owner = ownerCall(a, await team.token(team.claims(time.now())));
    const first = await (await owner('/island/api/send', { type: 'message', to: b.origin, text: 'hello' })).json();
    refuse = false;
    const statuses = (await Promise.all(Array.from({ length: 4 }, () => owner('/island/api/resend', { id: first.id })))).map((r) => r.status).sort();
    const rows = (await a.rows('SELECT COUNT(*) AS n FROM sent'))[0].n;
    const received = (await b.rows('SELECT COUNT(*) AS n FROM received'))[0].n;
    expect('D1: 4 concurrent resends, one new letter', statuses.join() === '200,409,409,409' && rows === 2 && received === 1, `${statuses.join()}, ${rows} rows, ${received} received`);
  }
} catch (error) {
  problems.push(String(/** @type {Error} */ (error)?.stack ?? error));
} finally {
  await proxy.dispose();
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problems:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nD1 check: pass');
