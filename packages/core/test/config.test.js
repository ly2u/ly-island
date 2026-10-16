import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildRobots, ConfigError, islandConfig, islandSigner, TEST_SEED } from '../src/index.js';

const THEMES = ['isometric', 'text'];
const base = { origin: 'https://example.org', name: '岛' };

test('defaults and environment overrides', () => {
  const config = islandConfig(base, { ISLAND_ORIGIN: 'https://dev.example.net', ISLAND_THEME: 'text' }, { themes: THEMES });
  assert.equal(config.origin, 'https://dev.example.net');
  assert.equal(config.theme, 'text');
  assert.deepEqual(config.language, ['en']);
  assert.equal(config.timeZone, 'UTC');
  assert.deepEqual(config.ai, { read: true, train: false });
  assert.equal(config.appearance.seed, 'https://dev.example.net');
  assert.equal(config.keyName, 'k1');
});

test('every setting problem is listed', () => {
  assert.throws(
    () => islandConfig({ origin: 'https://Example.org/', name: '', language: 'zh', timeZone: 'Mars/Base', theme: 'neon', appearance: { colors: ['red'] }, ai: { read: 'yes' }, keyName: 'k 1', extra: 1 }, {}, { themes: THEMES }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.equal(error.problems.length, 9);
      return true;
    },
  );
  for (const origin of ['http://example.org', 'https://example.org:8443', 'https://127.0.0.1', 'https://localhost', 'https://xn--fsq.example']) {
    assert.throws(() => islandConfig({ ...base, origin }), ConfigError, origin);
  }
});

test('the signing key: own key required, the test key only where it is safe', async () => {
  const real = { origin: 'https://dev.example.net', keyName: 'k1' };
  await assert.rejects(islandSigner({}, real), /ISLAND_SIGNING_KEY is not set/);
  await assert.rejects(islandSigner({ ISLAND_ALLOW_TEST_KEY: '1' }, real), /not set/);
  await assert.rejects(islandSigner({ ISLAND_SIGNING_KEY: TEST_SEED }, real), /public test key/);
  await assert.rejects(islandSigner({ ISLAND_SIGNING_KEY: 'abc' }, real), /64 hexadecimal/);
  const own = await islandSigner({ ISLAND_SIGNING_KEY: `  ${'AB'.repeat(32)}\n` }, real);
  assert.equal(own.keyId, 'https://dev.example.net#k1');
  assert.equal(own.test, false);
  assert.equal(JSON.stringify(own).includes('ab'.repeat(32)), false);
  assert.equal((await islandSigner({}, { ...real, dev: true })).test, true);
  const test = await islandSigner({ ISLAND_ALLOW_TEST_KEY: '1' }, { origin: 'https://example.org', keyName: 'k1' });
  assert.equal(test.publicKey, '0EqyMnQrtKs6E2i9RhXk5tAiSrcaAWuvhSCjMsl3hzc');
});

test('robots.txt follows the AI choices', () => {
  const closed = buildRobots({ read: true, train: false });
  assert.match(closed, /Content-Signal: search=yes, ai-input=yes, ai-train=no/);
  assert.match(closed, /User-agent: GPTBot\nDisallow: \//);
  assert.doesNotMatch(closed, /ChatGPT-User/);
  const open = buildRobots({ read: true, train: true });
  assert.doesNotMatch(open, /Disallow/);
  assert.match(buildRobots({ read: false, train: false }), /User-agent: Claude-User\nDisallow: \//);
});
