// Tests for the comparison's output checks, on a hand-made build output, so
// they run without installing either generator.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { encodeBase64url, importPrivateSeed, publicKeyOf } from '../../packages/protocol/src/index.js';
import { checkFeed, checkOutputs, expectedNotes } from './checks.mjs';
import { islandDocuments, SITE } from './shared/island-data.mjs';

const MEASURE = fileURLToPath(new URL('./measure.mjs', import.meta.url));
const NOTES = expectedNotes();
const DOCS = await islandDocuments(NOTES.map(({ slug, title, kind, summary, date }) => ({ slug, title, kind, summary, date })));
const temporary = [];
after(() => temporary.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** Escapes text for XML and HTML. */
const esc = (/** @type {string} */ text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A summary-only RSS feed like the ones both generators should produce. */
function feed({ itemExtra = '', rootAttributes = '', notes = NOTES, link = (n) => `${SITE}/notes/${n.slug}/`, description = (n) => n.summary } = {}) {
  const items = notes
    .map(
      (n) =>
        `<item><title>${esc(n.title)}</title><link>${link(n)}</link><guid isPermaLink="true">${link(n)}</guid>` +
        `<description>${esc(description(n))}</description><pubDate>${n.date.toUTCString()}</pubDate>${itemExtra}</item>`,
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"${rootAttributes}><channel><title>示例岛</title>` +
    `<description>示例</description><link>${SITE}/</link>\n${items}\n</channel></rss>\n`;
}

/** Writes a complete, correct build output; `overrides` replaces files by path. */
function dist(/** @type {Record<string, string | null>} */ overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ssg-compare-check-'));
  temporary.push(dir);
  /** @type {Record<string, string>} */
  const files = {
    '.well-known/island.json': JSON.stringify(DOCS.manifest),
    'island/outbox.json': JSON.stringify(DOCS.outbox),
    'island/friends.json': JSON.stringify(DOCS.friends),
    'feed.xml': feed(),
    'index.html': '<!doctype html><title>示例岛</title><svg viewBox="0 0 1 1"></svg>',
  };
  for (const n of NOTES) {
    files[`notes/${n.slug}/index.html`] = `<!doctype html><h1>${esc(n.title)}</h1>${n.slug === 'first-bridge' ? '<table></table>' : ''}`;
  }
  for (const [path, text] of Object.entries({ ...files, ...overrides })) {
    if (text === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe('a correct build output', () => {
  test('passes every check', async () => {
    assert.deepEqual(await checkOutputs(dist()), []);
  });

  test('passes the command line check with exit 0', () => {
    const run = spawnSync(process.execPath, [MEASURE, '--check', dist()], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
  });
});

describe('protocol files', () => {
  const paths = ['.well-known/island.json', 'island/outbox.json', 'island/friends.json'];
  const values = { null: 'null', false: 'false', zero: '0', string: '"text"', array: '[]', 'empty object': '{}' };

  for (const path of paths) {
    for (const [name, text] of Object.entries(values)) {
      test(`${path} as ${name} fails`, async () => {
        const problems = await checkOutputs(dist({ [path]: text }));
        assert.ok(problems.some((problem) => problem.startsWith(`${path}:`)), JSON.stringify(problems));
      });
    }
    test(`${path} missing or not JSON fails`, async () => {
      assert.ok((await checkOutputs(dist({ [path]: null }))).includes(`${path}: missing`));
      const broken = await checkOutputs(dist({ [path]: '{"protocol":' }));
      assert.ok(broken.some((problem) => problem.startsWith(`${path}: not JSON`)), JSON.stringify(broken));
    });
  }

  test('the cases from review (null, false, 0) make the command line check exit 1', () => {
    for (const [path, text] of [['.well-known/island.json', 'null'], ['island/outbox.json', 'false'], ['island/friends.json', '0']]) {
      const run = spawnSync(process.execPath, [MEASURE, '--check', dist({ [path]: text })], { encoding: 'utf8' });
      assert.equal(run.status, 1, `${path} = ${text}: ${run.stdout}`);
      assert.match(run.stdout, /must be a JSON object/);
    }
  });

  test('signatures are checked against the manifest key', async () => {
    const other = encodeBase64url(await publicKeyOf(await importPrivateSeed(new Uint8Array(32).fill(0x22))));
    const manifest = { ...DOCS.manifest, keys: [{ ...DOCS.manifest.keys[0], publicKey: other }] };
    const problems = await checkOutputs(dist({ '.well-known/island.json': JSON.stringify(manifest) }));
    assert.equal(problems.filter((problem) => problem.includes('does not verify (bad-signature)')).length, NOTES.length);
  });

  test('an invalid manifest is not trusted, so no signature is checked against it', async () => {
    const { links, ...withoutLinks } = DOCS.manifest;
    const problems = await checkOutputs(dist({ '.well-known/island.json': JSON.stringify(withoutLinks) }));
    assert.ok(problems.some((problem) => problem.startsWith('.well-known/island.json:')));
    assert.ok(!problems.some((problem) => problem.includes('does not verify')), JSON.stringify(problems));
  });

  test('the outbox must hold exactly the expected posts', async () => {
    const outbox = { ...DOCS.outbox, items: DOCS.outbox.items.slice(1) };
    const problems = await checkOutputs(dist({ 'island/outbox.json': JSON.stringify(outbox) }));
    assert.ok(problems.some((problem) => problem.includes('expected posts')), JSON.stringify(problems));
  });
});

describe('the feed', () => {
  test('three items but invalid XML (the plugin template from review) fails', () => {
    const text = feed({ itemExtra: '<content:encoded>&lt;p&gt;正文&lt;/p&gt;</content:encoded>' });
    assert.equal((text.match(/<item>/g) ?? []).length, 3);
    const problems = checkFeed(text, NOTES);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /^feed\.xml: not well-formed XML: unbound prefix content/);
  });

  test('three items but invalid XML makes the command line check exit 1', () => {
    const text = feed({ itemExtra: '<content:encoded>x</content:encoded>' });
    const run = spawnSync(process.execPath, [MEASURE, '--check', dist({ 'feed.xml': text })], { encoding: 'utf8' });
    assert.equal(run.status, 1, run.stdout);
    assert.match(run.stdout, /unbound prefix/);
  });

  test('full text, even with its namespace declared, is not the summary-only mode', () => {
    const text = feed({
      rootAttributes: ' xmlns:content="http://purl.org/rss/1.0/modules/content/"',
      itemExtra: '<content:encoded>正文</content:encoded>',
    });
    const problems = checkFeed(text, NOTES);
    assert.equal(problems.length, NOTES.length);
    assert.ok(problems.every((problem) => problem.includes('summary-only')));
  });

  test('a description that is not the summary fails', () => {
    const problems = checkFeed(feed({ description: (n) => `${n.summary}（全文）` }), NOTES);
    assert.equal(problems.length, NOTES.length);
  });

  test('wrong, repeated or missing links fail', () => {
    assert.ok(checkFeed(feed({ link: (n) => `${SITE}/posts/${n.slug}/` }), NOTES).length >= NOTES.length);
    const repeated = checkFeed(feed({ link: () => `${SITE}/notes/${NOTES[0].slug}/` }), NOTES);
    assert.ok(repeated.some((problem) => problem.includes('repeated')), JSON.stringify(repeated));
    const missing = checkFeed(feed({ notes: NOTES.slice(1) }), NOTES);
    assert.ok(missing.some((problem) => problem.includes(`expected ${NOTES.length} items`)), JSON.stringify(missing));
  });

  test('a wrong date or a second channel fails', () => {
    const shifted = feed().replace(NOTES[0].date.toUTCString(), new Date(NOTES[0].date.getTime() + 86400000).toUTCString());
    assert.equal(checkFeed(shifted, NOTES).length, 1);
    const twoChannels = feed().replace('</channel>', '</channel><channel/>');
    assert.match(checkFeed(twoChannels, NOTES)[0], /expected one <channel>, found 2/);
  });

  test('entities and CDATA are read as text', () => {
    const text = feed().replace(`<description>${esc(NOTES[0].summary)}</description>`, `<description><![CDATA[${NOTES[0].summary}]]></description>`);
    assert.deepEqual(checkFeed(text, NOTES), []);
  });
});

describe('pages', () => {
  test('a missing note page, a missing table or a home page without the island fail', async () => {
    const problems = await checkOutputs(
      dist({ 'notes/one-line/index.html': null, 'notes/first-bridge/index.html': '<h1>第一座桥的点云</h1>', 'index.html': '<p>no picture</p>' }),
    );
    assert.deepEqual(problems.sort(), [
      'index.html: no island picture',
      'notes/first-bridge: the Markdown table did not render',
      'notes/one-line/index.html: missing',
    ]);
  });
});
