// Tests for the site checks on a hand-made build output, so they run
// without installing Astro. Each negative case breaks one promise.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildFeed,
  buildIsland,
  buildRobots,
  islandConfig,
  islandSigner,
  normalizeRecords,
  publicRecords,
  TEST_SEED,
} from '../../packages/core/src/index.js';
import { checkSite, fileFor } from './checks.mjs';

const ORIGIN = 'https://example.org';
const HEADERS = fileURLToPath(new URL('../../site/public/_headers', import.meta.url));
const CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const temporary = [];
after(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const config = islandConfig({ origin: ORIGIN, name: '测试岛', language: ['zh-CN'], timeZone: 'Asia/Shanghai' });
const records = normalizeRecords(
  [
    { slug: 'first', kind: 'article', title: '第一篇', date: '2026-10-01', html: '<p>第一篇的正文，足够长的一段文字。</p>' },
    { slug: 'note', kind: 'note', date: '2026-10-02', html: '<p>一句话的短记录，也有一些字。</p>' },
    { slug: 'gone', kind: 'article', title: '撤回的', date: '2026-10-03', withdrawn: '2026-10-04', html: '<p>x</p>' },
  ],
  { origin: ORIGIN, timeZone: 'Asia/Shanghai', language: 'zh-CN' },
);
const island = await buildIsland({
  config,
  records,
  friends: [],
  ledger: { unlocked: [] },
  signer: await islandSigner({ ISLAND_ALLOW_TEST_KEY: '1' }, { origin: ORIGIN, keyName: 'k1' }),
  sourceDate: '2026-10-05T00:00:00Z',
});

/** @param {string} title @param {string} body */
const page = (title, body, extra = '') =>
  `<!doctype html><html lang="zh-CN"><head><title>${title}</title><link rel="island" href="/.well-known/island.json"><link rel="stylesheet" href="/_astro/site.css">${extra}</head><body><main>${body}</main></body></html>`;

/** A correct build; `change` edits files by path (null deletes). */
function build(/** @type {Record<string, string | Buffer | null>} */ change = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'site-check-'));
  temporary.push(dir);
  const shown = publicRecords(records);
  /** @type {Record<string, string | Buffer>} */
  const files = {
    'index.html': page('测试岛', `<svg role="img"></svg><ul>${shown.map((r) => `<li><a href="${r.path}">${r.displayTitle}</a></li>`).join('')}</ul>`, '<script type="module" src="/_astro/world.js"></script>'),
    '_astro/site.css': 'body{color:#222}',
    '_astro/world.js': 'console.log(1)',
    '.well-known/island.json': JSON.stringify(island.manifest),
    'island/friends.json': JSON.stringify(island.friends),
    'feed.xml': buildFeed({ config, records }),
    'robots.txt': buildRobots(config.ai),
    '_headers': readFileSync(HEADERS),
  };
  for (const outbox of island.outbox) files[outbox.path.slice(1)] = JSON.stringify(outbox.document);
  for (const record of shown) files[`records/${record.slug}/index.html`] = page(record.displayTitle, `<article><h1>${record.title ?? ''}</h1>${record.html}</article>`);
  for (const [path, content] of Object.entries({ ...files, ...change })) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** @param {Record<string, string | Buffer | null>} change @param {RegExp} expected */
async function fails(change, expected, options = {}) {
  const { problems } = await checkSite(build(change), { secrets: [TEST_SEED], ...options });
  assert.ok(problems.some((problem) => expected.test(problem)), JSON.stringify(problems, null, 1));
}

describe('a correct build', () => {
  test('passes, with a summary', async () => {
    const { problems, summary } = await checkSite(build(), { secrets: [TEST_SEED], theme: 'isometric', compare: build() });
    assert.deepEqual(problems, []);
    assert.equal(summary.activities, 3);
    assert.equal(summary.feedItems, 2);
    assert.ok(Number(summary.firstScreenGzipBytes) > 0);
  });

  test('the command line exits 0, and 1 when something fails', () => {
    assert.equal(spawnSync(process.execPath, [CLI, build()], { encoding: 'utf8' }).status, 0);
    assert.equal(spawnSync(process.execPath, [CLI, build({ 'feed.xml': '<rss>' })], { encoding: 'utf8' }).status, 1);
  });
});

describe('each broken promise is caught', () => {
  test('protocol: a bad signature, a missing link target, an orphan outbox page', async () => {
    const tampered = structuredClone(island.outbox[0].document);
    tampered.items[1].object.title = '改过的标题';
    await fails({ 'island/outbox.json': JSON.stringify(tampered) }, /does not verify \(bad-signature\)/);
    await fails({ 'island/friends.json': null }, /manifest link friends .* is not in the build/);
    await fails({ 'island/outbox-7.json': JSON.stringify(island.outbox[0].document) }, /outbox-7\.json: an outbox page that no other page links to/);
    await fails({ '.well-known/island.json': 'null' }, /must be a JSON object/);
  });

  test('records: a withdrawn page still published, a record page missing or unreachable', async () => {
    await fails({ 'records/gone/index.html': page('撤回的', '<p>还在</p>') }, /withdrawn page .* is still published/);
    await fails({ 'records/note/index.html': null }, /its page .* is not in the build/);
    await fails({ 'index.html': page('测试岛', '<p>no links</p>') }, /not reachable by links from the home page/);
    await fails({ 'index.html': page('测试岛', '<script>document.write(\'<a href="/records/first/">x</a>\')</script><a href="/records/note/">n</a>') }, /\/records\/first\/: not reachable/);
  });

  test('feed: not well-formed, or missing a record', async () => {
    await fails({ 'feed.xml': buildFeed({ config, records }).replace('xmlns:content=', 'xmlns:other=') }, /unbound prefix content/);
    await fails({ 'feed.xml': buildFeed({ config, records: records.filter((r) => r.slug !== 'note') }) }, /1 items, expected 2/);
  });

  test('pages: third-party resources and code the Content-Security-Policy blocks', async () => {
    await fails({ 'index.html': page('x', '<a href="/records/first/">1</a><a href="/records/note/">2</a>', '<script src="https://cdn.example/x.js"></script>') }, /third-party resource https:\/\/cdn\.example\/x\.js/);
    await fails({ '_astro/site.css': '@import "https://fonts.example/a.css";' }, /third-party resource \/\/fonts\.example/);
    await fails({ 'records/first/index.html': page('x', '<p>第一篇的正文，足够长的一段文字。</p><h1>第一篇</h1><script>alert(1)</script>') }, /inline script/);
    await fails({ 'records/first/index.html': page('x', '<h1 style="color:red">第一篇</h1><p>第一篇的正文，足够长的一段文字。</p>') }, /style attribute/);
    await fails({ 'records/first/index.html': page('x', '<h1 onclick="x()">第一篇</h1><p>第一篇的正文，足够长的一段文字。</p>') }, /inline event handler/);
    await fails({ 'records/first/index.html': page('x', '<h1>第一篇</h1>').replace(' lang="zh-CN"', '') }, /no lang/);
  });

  test('budget, theme, hosting files and secrets', async () => {
    const noise = randomBytes(300 * 1024);
    await fails({ '_astro/world.js': noise }, /first screen is \d+ bytes gzipped, over the 204800 budget/);
    await fails({}, /text theme: the home page has a script/, { theme: 'text' });
    await fails({ '_headers': '/*\n  X-Frame-Options: DENY\n' }, /\/island\/\* needs Access-Control-Allow-Origin/);
    await fails({ 'robots.txt': 'User-agent: *\nAllow: /\n' }, /Content-Signal line/);
    await fails({ '_astro/world.js': `const key = "${TEST_SEED}";` }, /_astro\/world\.js: contains the signing key/);
  });

  test('reproducibility: protocol files must match a second build', async () => {
    const other = build({ 'feed.xml': buildFeed({ config, records }).replace('<lastBuildDate>', '<lastBuildDate>Mon, ') });
    const { problems } = await checkSite(build(), { compare: other });
    assert.ok(problems.includes('feed.xml: differs between two builds of the same sources'), JSON.stringify(problems));
  });
});

test('URLs map to the files that serve them', () => {
  assert.equal(fileFor('https://example.org/records/a/', ORIGIN), 'records/a/index.html');
  assert.equal(fileFor('/feed.xml', ORIGIN), 'feed.xml');
  assert.equal(fileFor('../b/', ORIGIN, '/records/a/'), 'records/b/index.html');
  assert.equal(fileFor('https://other.example/', ORIGIN), null);
  assert.equal(fileFor('mailto:a@example.org', ORIGIN), null);
});
