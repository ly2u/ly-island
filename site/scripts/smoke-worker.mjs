// Runs the built island in workerd (wrangler dev, local mode, with a local
// D1) and checks that the service's routes answer the way the Node tests
// expect. CI runs it after `npm run build`; it needs the public test key
// build (ISLAND_ALLOW_TEST_KEY=1, https://example.org).
//
//   node scripts/smoke-worker.mjs
//
// Covered here because only workerd shows them: the bundle starts, D1 works
// with the self-migrating schema, run_worker_first sends exactly the
// service's paths to the Worker, _headers apply to static files, and the
// cron handler runs.

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { TEST_SEED } from '../../packages/core/src/index.js';

const PORT = 8700 + Math.floor(Math.random() * 200);
const base = `http://127.0.0.1:${PORT}`;
const state = mkdtempSync(join(tmpdir(), 'island-smoke-'));
/** @type {string[]} */
const problems = [];
let log = '';

const generate = spawn(process.execPath, ['scripts/wrangler-config.mjs'], { stdio: 'inherit' });
await new Promise((resolve, reject) => generate.on('exit', (code) => (code === 0 ? resolve(undefined) : reject(new Error('wrangler-config failed')))));

const wrangler = spawn('npx', [
  'wrangler', 'dev',
  '--config', 'wrangler.generated.json',
  '--ip', '127.0.0.1',
  '--port', String(PORT),
  '--persist-to', state,
  '--test-scheduled',
  '--show-interactive-dev-session=false',
  '--var', `ISLAND_SIGNING_KEY:${TEST_SEED}`,
  // A host name without https:// (the service accepts both): --var splits at the first colon.
  '--var', 'ACCESS_TEAM_DOMAIN:smoke.cloudflareaccess.com',
  '--var', 'ACCESS_AUD:smoke-test-audience',
], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' } });
wrangler.stdout.on('data', (chunk) => { log += chunk; });
wrangler.stderr.on('data', (chunk) => { log += chunk; });

/** @param {string} path @param {RequestInit} [init] */
const request = (path, init) => fetch(`${base}${path}`, { redirect: 'manual', ...init });

async function ready() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (wrangler.exitCode !== null) throw new Error(`wrangler dev exited with ${wrangler.exitCode}`);
    try {
      if ((await request('/')).status === 200) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('wrangler dev did not start within 90 seconds');
}

/** @param {string} what @param {unknown} actual @param {unknown} expected */
function expect(what, actual, expected) {
  const ok = expected instanceof RegExp ? expected.test(String(actual)) : actual === expected;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}: ${String(actual)}`);
  if (!ok) problems.push(`${what}: expected ${String(expected)}, got ${String(actual)}`);
}

try {
  await ready();
  const manifest = JSON.parse(readFileSync('dist/.well-known/island.json', 'utf8'));
  const self = manifest.id;

  // Static files come from the assets, with the headers from _headers.
  const home = await request('/');
  expect('home page', home.status, 200);
  expect('home page CSP', home.headers.get('content-security-policy'), /script-src 'self'/);
  const card = await request('/.well-known/island.json');
  expect('manifest', card.status, 200);
  expect('manifest is readable from other origins', card.headers.get('access-control-allow-origin'), '*');
  expect('manifest names the inbox', (await card.json()).links?.inbox, `${self}/island/inbox`);

  // The inbox: the service answers, and the store works (D1 and migrations).
  const junk = await request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"not":"an activity"}' });
  expect('junk delivery', junk.status, 400);
  const tooLarge = await request('/island/inbox', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(17 * 1024) });
  expect('oversized delivery', tooLarge.status, 413);
  expect('inbox only takes POST', (await request('/island/inbox')).status, 405);

  // Owner paths: no Access token, no entry, whatever else is sent.
  // The Access settings are read (otherwise the reason is access-not-configured).
  for (const path of ['/island/api/me', '/island/admin/', '/island/admin', '/island/compose?type=message&to=https://example.net', '/island/api/export']) {
    const response = await request(path, { headers: { 'cf-access-authenticated-user-email': 'owner@example.org' } });
    expect(`owner-only ${path}`, `${response.status} ${(await response.json()).reason}`, '403 no-token');
  }
  const ai = await request('/island/ai/inbox', { headers: { authorization: 'Bearer isl_0000000000000000000000000000000000000000000' } });
  expect('unknown AI token', ai.status, 401);

  // "Reply from my island": a page that moves on to the visitor's island.
  const go = await request(`/island/go?home=${encodeURIComponent('https://example.net')}&type=message&returnTo=${encodeURIComponent(`${self}/`)}`);
  expect('reply from my island', go.status, 200);
  expect('reply page moves on', await go.text(), /http-equiv="refresh" content="0; url=https:\/\/example\.net\//);
  expect('bad home address', (await request('/island/go?home=javascript%3Aalert(1)')).status, 400);

  // Static files in /island/ that are not service paths stay static.
  expect('outbox stays static', (await request('/island/outbox.json')).status, 200);

  // The cron handler: runs, migrates, reports its subrequests.
  // The local cron route: /cdn-cgi/local/scheduled, /__scheduled in older Wrangler.
  let cron = await request(`/cdn-cgi/local/scheduled?cron=${encodeURIComponent('* * * * *')}`);
  if (cron.status === 404) cron = await request(`/__scheduled?cron=${encodeURIComponent('* * * * *')}`);
  expect('cron run', cron.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect('cron report', log, /island cron \{"retried":0,"polled":\[\],"verified":0,.*"used":\d+\}/);
} catch (error) {
  problems.push(String(/** @type {Error} */ (error).message));
} finally {
  wrangler.kill('SIGTERM');
  rmSync(state, { recursive: true, force: true });
  rmSync('wrangler.generated.json', { force: true });
}

if (problems.length > 0) {
  console.log('\nwrangler dev output:\n' + log.split('\n').slice(-60).join('\n'));
  console.error(`\n${problems.length} problems:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log('\nworkerd smoke test: pass');
process.exit(0);
