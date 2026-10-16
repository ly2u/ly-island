import assert from 'node:assert/strict';
import { test } from 'node:test';

import { access, clock, island, network, ownerCall, SEEDS } from './harness.js';

async function setup({ resolver = null } = {}) {
  const net = network();
  const time = clock();
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, resolver });
  const b = await island({ net, time, origin: 'https://b.example', seed: SEEDS.b });
  const asA = ownerCall(a, await team.token(team.claims(time.now())));
  return { net, time, team, a, b, asA };
}

const message = (to) => ({ type: 'message', to, text: '你好' });

test('an inbox that redirects is never followed, and the failure is final', async () => {
  const { net, a, b, asA } = await setup();
  const original = net.hosts.get('b.example');
  net.route('b.example', (request) =>
    new URL(request.url).pathname === '/island/inbox' ? new Response(null, { status: 307, headers: { location: 'https://evil.example/collect' } }) : original(request));
  net.route('evil.example', () => {
    throw new Error('must not be reached');
  });
  const result = await (await asA('/island/api/send', message(b.origin))).json();
  assert.deepEqual([result.status, result.reason], ['failed', 'redirect-not-followed']);
  assert.equal(net.count((entry) => entry.url.includes('evil.example')), 0);
  assert.deepEqual((await a.rows("SELECT type FROM events WHERE type = 'delivery.failed'")).length, 1);
});

test('with a resolver (self-hosting), names that resolve to private addresses are never connected', async () => {
  const resolver = async (/** @type {string} */ host) => (host === 'b.example' ? ['10.0.0.7'] : ['93.184.216.34']);
  const { net, b, asA } = await setup({ resolver });
  const before = net.count((entry) => entry.url.startsWith(b.origin));
  const result = await (await asA('/island/api/send', message(b.origin))).json();
  assert.deepEqual([result.status, result.reason], ['failed', 'forbidden-address']);
  assert.equal(net.count((entry) => entry.url.startsWith(b.origin)), before, 'no request reached b.example');
});

test('addresses from other islands must follow the rules: no IPs, ports, local names or plain http', async () => {
  const { net, asA } = await setup();
  for (const to of ['http://b.example', 'https://10.0.0.1', 'https://b.example:8443', 'https://localhost', 'https://intranet']) {
    const response = await asA('/island/api/send', message(to));
    assert.equal(response.status, 400, to);
  }
  assert.equal(net.count((entry) => entry.method === 'POST' && entry.url.endsWith('/island/inbox')), 0);
});

test('5xx retries at most 3 times within a day; 429 waits for Retry-After', async () => {
  const { net, time, team, a, b, asA } = await setup();
  const original = net.hosts.get('b.example');
  let answer = 503;
  net.route('b.example', (request) =>
    new URL(request.url).pathname === '/island/inbox' && answer !== 202 ? new Response(null, { status: answer, headers: answer === 429 ? { 'retry-after': '120' } : {} }) : original(request));

  const first = await (await asA('/island/api/send', message(b.origin))).json();
  assert.deepEqual([first.status, first.reason], ['pending', 'HTTP 503']);
  await a.cron();
  assert.equal((await a.rows('SELECT attempts FROM sent'))[0].attempts, 1, 'not due yet');
  time.advance(61 * 60_000);
  answer = 429;
  await a.cron();
  let [row] = await a.rows('SELECT status, attempts, next_at FROM sent');
  assert.equal(row.status, 'pending');
  assert.equal(row.next_at, time.now() + 120_000);
  time.advance(121_000);
  answer = 202;
  await a.cron();
  [row] = await a.rows('SELECT status FROM sent');
  assert.equal(row.status, 'delivered');
  assert.equal((await b.rows('SELECT * FROM received')).length, 1);

  // And a recipient that stays down fails after the third retry, with one event.
  answer = 500;
  // The first login has expired by now: log in again.
  await ownerCall(a, await team.token(team.claims(time.now())))('/island/api/send', message(b.origin));
  for (const wait of [61, 4 * 60 + 1, 12 * 60 + 1]) {
    time.advance(wait * 60_000);
    await a.cron();
  }
  const failed = await a.rows("SELECT status, attempts FROM sent WHERE status != 'delivered'");
  assert.deepEqual(failed, [{ status: 'failed', attempts: 4 }]);
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'delivery.failed'")).length, 1);
});

test('nothing is posted to an island whose key history is paused, until the owner confirms', async () => {
  const { net, time, team, a, b, asA } = await setup();
  const posts = () => net.count((entry) => entry.method === 'POST' && entry.url === `${b.origin}/island/inbox`);
  assert.equal((await (await asA('/island/api/send', message(b.origin))).json()).status, 'delivered');

  // A second message meets a 503 and waits for its retry.
  const original = net.hosts.get('b.example');
  let down = true;
  net.route('b.example', (request) => (new URL(request.url).pathname === '/island/inbox' && down ? new Response(null, { status: 503 }) : original(request)));
  assert.equal((await (await asA('/island/api/send', message(b.origin))).json()).status, 'pending');
  down = false;

  // A day later b's manifest shows another key and no key log explains it.
  time.advance(25 * 3_600_000);
  await b.rekey('e5'.repeat(32));
  const before = posts();
  // The retry refreshes b's manifest, finds the unknown key, and holds the letter.
  await a.cron();
  assert.equal(posts(), before, 'no POST to the paused island on retry');
  const [island] = await a.rows("SELECT history FROM islands WHERE origin = 'https://b.example'");
  assert.equal(JSON.parse(island.history).status, 'paused');
  assert.deepEqual((await a.rows("SELECT status FROM sent ORDER BY created")).map((r) => r.status), ['delivered', 'held']);
  // A new message to the already paused island is held too, without a request.
  const asA2 = ownerCall(a, await team.token(team.claims(time.now())));
  const third = await (await asA2('/island/api/send', message(b.origin))).json();
  assert.deepEqual([third.status, third.reason], ['held', 'recipient-key-mismatch']);
  assert.equal(posts(), before, 'no POST for a new message either');
  await a.cron();
  assert.equal(posts(), before, 'held letters are not retried');
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'key.changed'")).length, 1, 'the owner is told once');

  // The owner confirms the new key: the held letters go out with the next run.
  const confirmed = await (await asA2('/island/api/islands', { origin: b.origin, action: 'retrust' })).json();
  assert.equal(confirmed.released, 2);
  await a.cron();
  assert.equal(posts(), before + 2);
  assert.deepEqual((await a.rows("SELECT status FROM sent ORDER BY created")).map((r) => r.status), ['delivered', 'delivered', 'delivered']);
});

test('a manifest refresh that finds an unexplained key holds the very letter that found it', async () => {
  const { net, time, team, a, b, asA } = await setup();
  assert.equal((await (await asA('/island/api/send', message(b.origin))).json()).status, 'delivered');
  time.advance(25 * 3_600_000);
  await b.rekey('e5'.repeat(32));
  const before = net.count((entry) => entry.method === 'POST' && entry.url === `${b.origin}/island/inbox`);
  const send = ownerCall(a, await team.token(team.claims(time.now())));
  const result = await (await send('/island/api/send', message(b.origin))).json();
  assert.deepEqual([result.ok, result.status], [false, 'held']);
  assert.equal(net.count((entry) => entry.method === 'POST' && entry.url === `${b.origin}/island/inbox`), before);
  assert.equal((await a.rows("SELECT * FROM events WHERE type = 'key.changed'")).length, 1);
});

test('without its signing key the service still receives, but refuses to send', async () => {
  const { a, b, asA } = await setup();
  a.env.ISLAND_SIGNING_KEY = '';
  // A new isolate would read the secret afresh; the cache is per key value.
  const me = await (await asA('/island/api/me')).json();
  assert.equal(me.canSend, false);
  const result = await (await asA('/island/api/send', message(b.origin))).json();
  assert.equal(result.reason, 'no-signing-key');
  a.env.ISLAND_SIGNING_KEY = SEEDS.c;
  assert.match((await (await asA('/island/api/me')).json()).signingProblem, /does not match/);
});

test('"reply from my island" goes to the visitor\'s own compose page, never elsewhere', async () => {
  const { a, b } = await setup();
  /** The page moves on by itself (a redirect after a form would break the record page's form-action). */
  const next = async (/** @type {Response} */ response) => {
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
    const html = await response.text();
    const refresh = /<meta http-equiv="refresh" content="0; url=([^"]+)">/.exec(html)?.[1].replaceAll('&#38;', '&');
    const link = /<a href="([^"]+)">/.exec(html)?.[1].replaceAll('&#38;', '&');
    assert.equal(refresh, link);
    return new URL(/** @type {string} */ (link));
  };
  const record = `${b.origin}/records/r1/`;
  const target = await next(await b.request(`/island/go?home=${encodeURIComponent(a.origin)}&type=message&inReplyTo=${encodeURIComponent(record)}&returnTo=${encodeURIComponent(record)}`));
  assert.equal(`${target.origin}${target.pathname}`, 'https://a.example/island/compose');
  assert.equal(target.searchParams.get('to'), b.origin);
  assert.equal(target.searchParams.get('inReplyTo'), record);
  assert.equal(target.searchParams.get('returnTo'), record);
  // Typed the way people type it.
  for (const home of ['a.example', 'https://a.example/', ' A.EXAMPLE ']) {
    assert.equal((await next(await b.request(`/island/go?home=${encodeURIComponent(home)}`))).origin, 'https://a.example', home);
  }
  // returnTo and inReplyTo must belong to this island; home must be an island address.
  const sneaky = await next(await b.request(`/island/go?home=${encodeURIComponent(a.origin)}&returnTo=${encodeURIComponent('https://evil.example/')}&inReplyTo=${encodeURIComponent('https://evil.example/x')}`));
  assert.equal(sneaky.searchParams.get('returnTo'), null);
  assert.equal(sneaky.searchParams.get('inReplyTo'), null);
  for (const home of ['javascript:alert(1)', 'http://a.example', 'https://a.example/path', 'https://a.example/?x=1', 'https://user@a.example', '', b.origin]) {
    const response = await b.request(`/island/go?home=${encodeURIComponent(home)}&returnTo=${encodeURIComponent('"><script>')}`);
    assert.equal(response.status, 400, home);
    const html = await response.text();
    assert.doesNotMatch(html, /<script|http-equiv/, home);
    assert.match(html, /<a href="https:\/\/b\.example\/">/, home);
  }
});

test('export returns everything except token hashes', async () => {
  const { a, b, asA } = await setup();
  await asA('/island/api/send', message(b.origin));
  await asA('/island/api/tokens', { scope: 'read', label: 'x' });
  const response = await asA('/island/api/export');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="island-export-/);
  const data = await response.json();
  assert.equal(data.sent.length, 1);
  assert.deepEqual(Object.keys(data.tokens[0]).sort(), ['created', 'label', 'revoked', 'scope']);
});
