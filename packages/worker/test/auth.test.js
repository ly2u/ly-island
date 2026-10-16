import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { encodeBase64url } from '../../protocol/src/index.js';
import { access, AUD, clock, island, network, ownerCall, SEEDS, TEAM } from './harness.js';

async function setup(env = {}) {
  const net = network();
  const time = clock();
  const team = await access(net);
  const a = await island({ net, time, origin: 'https://a.example', seed: SEEDS.a, env });
  return { net, time, team, a };
}

const get = (/** @type {any} */ a, /** @type {string} */ path, headers = {}) => a.request(path, { headers });

describe('owner endpoints', () => {
  test('a valid Access token gets in, on the API, the admin pages and compose', async () => {
    const { time, team, a } = await setup();
    const token = await team.token(team.claims(time.now()));
    assert.equal((await get(a, '/island/api/me', { 'cf-access-jwt-assertion': token })).status, 200);
    const page = await get(a, '/island/admin/', { 'cf-access-jwt-assertion': token });
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.equal(page.headers.get('access-control-allow-origin'), null);
    assert.equal(page.headers.get('x-robots-tag'), 'noindex');
    const compose = await get(a, '/island/compose?type=message&to=https://b.example', { 'cf-access-jwt-assertion': token });
    assert.equal(compose.status, 303);
    assert.equal(compose.headers.get('location'), 'https://a.example/island/admin/#compose?type=message&to=https://b.example');
  });

  test('everything else is refused, with the reason', async () => {
    const { time, team, a } = await setup();
    const claims = team.claims(time.now());
    const now = Math.floor(time.now() / 1000);
    const cases = {
      'no-token': {},
      'malformed-token': { 'cf-access-jwt-assertion': 'abc.def' },
      'bad-signature': { 'cf-access-jwt-assertion': await team.token(claims, { key: team.otherKey }) },
      'wrong-audience': { 'cf-access-jwt-assertion': await team.token({ ...claims, aud: ['another-app'] }) },
      'wrong-issuer': { 'cf-access-jwt-assertion': await team.token({ ...claims, iss: 'https://evil.cloudflareaccess.com' }) },
      expired: { 'cf-access-jwt-assertion': await team.token({ ...claims, exp: now - 120 }) },
      'not-yet-valid': { 'cf-access-jwt-assertion': await team.token({ ...claims, nbf: now + 600 }) },
      'wrong-algorithm': { 'cf-access-jwt-assertion': await team.token(claims, { header: { alg: 'none' } }) },
      'unknown-key': { 'cf-access-jwt-assertion': await team.token(claims, { header: { kid: 'other' } }) },
    };
    for (const [expected, headers] of Object.entries(cases)) {
      for (const path of ['/island/api/me', '/island/admin/', '/island/compose']) {
        const response = await get(a, path, headers);
        assert.equal(response.status, 403, `${expected} on ${path}`);
        assert.equal((await response.json()).reason, expected, `${expected} on ${path}`);
      }
    }
    // A forged identity header without a token is ignored.
    const forged = await get(a, '/island/api/me', { 'cf-access-authenticated-user-email': 'owner@example.org' });
    assert.equal((await forged.json()).reason, 'no-token');
    // An unsigned token (alg none, empty signature) is refused.
    const unsigned = `${encodeBase64url(new TextEncoder().encode('{"alg":"none"}'))}.${encodeBase64url(new TextEncoder().encode(JSON.stringify(claims)))}.`;
    assert.equal((await get(a, '/island/api/me', { 'cf-access-jwt-assertion': unsigned })).status, 403);
  });

  test('without Access configuration, nobody is the owner', async () => {
    for (const env of [{ ACCESS_TEAM_DOMAIN: '' }, { ACCESS_AUD: '' }, { ACCESS_TEAM_DOMAIN: 'https://evil.example' }]) {
      const { time, team, a } = await setup(env);
      const response = await get(a, '/island/api/me', { 'cf-access-jwt-assertion': await team.token(team.claims(time.now())) });
      assert.equal((await response.json()).reason, 'access-not-configured', JSON.stringify(env));
    }
  });

  test('the team domain may leave out https://, and several AUD tags may be listed', async () => {
    const env = { ACCESS_TEAM_DOMAIN: TEAM.replace('https://', ''), ACCESS_AUD: `other-app, ${AUD}` };
    const { time, team, a } = await setup(env);
    const token = await team.token(team.claims(time.now()));
    assert.equal((await get(a, '/island/api/me', { 'cf-access-jwt-assertion': token })).status, 200);
    const wrong = await team.token({ ...team.claims(time.now()), aud: ['third-app'] });
    assert.equal((await (await get(a, '/island/api/me', { 'cf-access-jwt-assertion': wrong })).json()).reason, 'wrong-audience');
    const empty = await setup({ ACCESS_AUD: ' , ' });
    const response = await get(empty.a, '/island/api/me', { 'cf-access-jwt-assertion': await empty.team.token(empty.team.claims(empty.time.now())) });
    assert.equal((await response.json()).reason, 'access-not-configured');
  });

  test('owner writes must be same-origin JSON POSTs', async () => {
    const { time, team, a } = await setup();
    const token = await team.token(team.claims(time.now()));
    const post = (headers, body = '{"origin":"https://b.example","action":"block"}') =>
      a.request('/island/api/islands', { method: 'POST', headers: { 'cf-access-jwt-assertion': token, ...headers }, body });
    assert.equal((await post({ 'content-type': 'application/json' })).status, 403, 'no Origin');
    assert.equal((await post({ 'content-type': 'application/json', origin: 'https://evil.example' })).status, 403, 'other Origin');
    assert.equal((await post({ 'content-type': 'application/x-www-form-urlencoded', origin: a.origin }, 'origin=x')).status, 403, 'a form');
    assert.equal((await post({ 'content-type': 'application/json', origin: a.origin })).status, 200);
    assert.equal((await a.rows("SELECT blocked FROM islands WHERE origin = 'https://b.example'"))[0].blocked, 1);
  });
});

describe('AI tokens', () => {
  test('read and draft scopes; never owner endpoints, never sending', async () => {
    const { time, team, a } = await setup();
    const owner = ownerCall(a, await team.token(team.claims(time.now())));
    const read = (await (await owner('/island/api/tokens', { scope: 'read', label: 'assistant' })).json()).token;
    const draft = (await (await owner('/island/api/tokens', { scope: 'draft', label: 'writer' })).json()).token;
    assert.match(read, /^isl_[A-Za-z0-9_-]{43}$/);
    assert.equal((await a.rows('SELECT hash FROM tokens')).every((row) => /^[0-9a-f]{64}$/.test(row.hash) && row.hash !== read), true);

    const ai = (/** @type {string} */ token, /** @type {string} */ path, /** @type {unknown} */ body) =>
      a.request(path, body === undefined
        ? { headers: { authorization: `Bearer ${token}` } }
        : { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal((await ai(read, '/island/ai/inbox')).status, 200);
    assert.equal((await ai(read, '/island/ai/feed')).status, 200);
    const draftBody = { type: 'message', to: 'https://b.example', text: '起草的回复' };
    assert.equal((await ai(read, '/island/ai/drafts', draftBody)).status, 403, 'read cannot draft');
    assert.equal((await ai(draft, '/island/ai/drafts', draftBody)).status, 201);
    assert.equal((await a.rows('SELECT by FROM drafts'))[0].by, 'writer');
    // No sending or owner endpoint is reachable with an AI token.
    for (const path of ['/island/ai/send', '/island/ai/follow', '/island/ai/tokens']) assert.equal((await ai(draft, path, draftBody)).status, 403, path);
    for (const path of ['/island/api/send', '/island/api/me', '/island/admin/']) assert.equal((await ai(draft, path, draftBody)).status, 403, path);
    // Revoked tokens stop working.
    const [{ hash }] = await a.rows("SELECT hash FROM tokens WHERE label = 'writer'");
    await owner('/island/api/tokens/revoke', { hash });
    assert.equal((await ai(draft, '/island/ai/inbox')).status, 401);
    assert.equal((await ai('isl_' + 'x'.repeat(43), '/island/ai/inbox')).status, 401);
  });
});
