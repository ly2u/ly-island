// Real Astro builds in a disposable checkout: checks the raw Markdown ->
// loader -> schema -> normalized records -> signed documents path, not just
// the standalone date/slug helpers. Run after npm ci, before production builds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'island-loader-'));
const site = join(scratch, 'site');
try {
  cpSync(join(repo, 'packages'), join(scratch, 'packages'), { recursive: true });
  cpSync(join(repo, 'site'), site, {
    recursive: true,
    filter: (path) => !['dist', 'dist-first', 'dist-isometric', 'node_modules', '.astro', '.wrangler'].includes(basename(path)),
  });
  cpSync(join(repo, 'site/node_modules'), join(site, 'node_modules'), { recursive: true });
  const recordDir = join(site, 'content/records');
  const settings = JSON.parse(readFileSync(join(site, 'island.config.json'), 'utf8'));
  const zone = (/** @type {string} */ timeZone) =>
    writeFileSync(join(site, 'island.config.json'), JSON.stringify({ ...settings, timeZone }));
  zone('America/Los_Angeles');
  const reset = () => {
    rmSync(recordDir, { recursive: true, force: true });
    mkdirSync(recordDir, { recursive: true });
    rmSync(join(site, '.astro'), { recursive: true, force: true });
  };
  const record = (name, metadata) => writeFileSync(join(recordDir, name), `---\ntitle: Loader regression\nkind: project\n${metadata}\n---\nA synthetic record for the loader checks.\n`);
  const build = () => {
    const result = spawnSync('npm', ['run', 'build'], {
      cwd: site, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, ISLAND_ALLOW_TEST_KEY: '1', ISLAND_SIGNING_KEY: '', ISLAND_ORIGIN: 'https://example.org', ASTRO_TELEMETRY_DISABLED: '1', SOURCE_DATE_EPOCH: '1792022400' },
    });
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  };
  let cases = 0;
  for (const raw of ['null', 'false', '0', '2026-02-30', '"2026-02-30T00:00:00Z"', '"2026-10-05T00:00:00"']) {
    reset();
    record('bad-date.md', `date: ${raw}`);
    const result = build();
    assert.notEqual(result.status, 0, `date ${raw} was accepted`);
    assert.match(result.output, /date|timestamp/);
    cases++;
  }
  for (const field of ['done', 'withdrawn', 'updated']) {
    for (const raw of ['null', '2026-02-30']) {
      reset();
      record(`bad-${field}.md`, `date: 2024-02-29\n${field}: ${raw}`);
      const result = build();
      assert.notEqual(result.status, 0, `${field} ${raw} was accepted`);
      assert.match(result.output, new RegExp(field));
      cases++;
    }
  }
  for (const names of [['REVIEW-UPPER.md'], ['REVIEW-COLLISION.md', 'review-collision.md'], ['trailing-newline\n.md']]) {
    reset();
    for (const name of names) record(name, 'date: 2026-10-05');
    const result = build();
    assert.notEqual(result.status, 0, `${names.join(', ')} was accepted`);
    assert.match(result.output, /file name must use lowercase/);
    cases++;
  }
  reset();
  record('date-only.md', 'date: 2026-10-05');
  record('utc-midnight.md', 'date: 2026-10-05T00:00:00Z');
  record('leap-day.md', 'date: "2024-02-29"');
  record('offset.md', 'date: 2026-10-05T00:30:00+08:00');
  record('year-boundary.md', 'date: 2027-01-04T00:00:00Z');
  record('finished.md', 'date: 2026-10-04\ndone: 2026-10-05T00:00:00Z');
  record('withdrawn.md', 'date: 2026-10-04\nwithdrawn: 2026-10-05T00:00:00Z');
  const valid = build();
  assert.equal(valid.status, 0, valid.output);
  for (const [slug, date] of [
    ['date-only', '2026-10-05'], ['utc-midnight', '2026-10-04'], ['leap-day', '2024-02-29'],
    ['offset', '2026-10-04'], ['year-boundary', '2027-01-03'],
  ]) {
    assert.ok(readFileSync(join(site, `dist/records/${slug}/index.html`), 'utf8').includes(`>${date}</time>`), `${slug}: wrong local date`);
  }
  const outbox = JSON.parse(readFileSync(join(site, 'dist/island/outbox.json'), 'utf8'));
  const deletion = outbox.items.find((item) => item.type === 'delete');
  assert.equal(deletion.published, '2026-10-05T00:00:00Z');
  assert.ok(readFileSync(join(site, 'dist/records/finished/index.html'), 'utf8').includes('datetime="2026-10-04">2026-10-04</time>'));

  // Clock changes at midnight. Samoa skipped 2011-12-30: a date that does not
  // exist there fails instead of being signed as the next day.
  zone('Pacific/Apia');
  reset();
  record('skipped-day.md', 'date: 2011-12-30');
  const skipped = build();
  assert.notEqual(skipped.status, 0, 'a day Pacific/Apia skipped was accepted');
  assert.match(skipped.output, /2011-12-30 does not exist in Pacific\/Apia/);
  cases++;

  // Amman repeated 00:00-01:00 on 2021-10-29: an update in the first hour is after the day began.
  zone('Asia/Amman');
  reset();
  record('first-hour.md', 'date: 2021-10-29\nupdated: 2021-10-29T00:30:00+03:00');
  const amman = build();
  assert.equal(amman.status, 0, amman.output);
  const ammanPost = JSON.parse(readFileSync(join(site, 'dist/island/outbox.json'), 'utf8')).items.find((item) => item.type === 'post');
  assert.equal(ammanPost.published, '2021-10-28T21:00:00Z');
  assert.equal(ammanPost.updated, '2021-10-28T21:30:00Z');

  // Shanghai: a timed date with same-day dates, and a date with an early-morning update.
  zone('Asia/Shanghai');
  reset();
  record('timed-then-dates.md', 'date: 2026-10-05T20:00:00+08:00\ndone: 2026-10-05\nwithdrawn: 2026-10-05');
  record('date-then-morning.md', 'date: 2026-10-05\nupdated: 2026-10-05T06:00:00+08:00');
  const shanghai = build();
  assert.equal(shanghai.status, 0, shanghai.output);
  const shanghaiItems = JSON.parse(readFileSync(join(site, 'dist/island/outbox.json'), 'utf8')).items;
  assert.equal(shanghaiItems.find((item) => item.type === 'delete').published, '2026-10-05T12:00:00Z');
  const morning = shanghaiItems.find((item) => item.type === 'post');
  assert.equal(morning.published, '2026-10-04T16:00:00Z');
  assert.equal(morning.updated, '2026-10-04T22:00:00Z');

  console.log(`record loader: ${cases} failing-build cases rejected; leap day, date-only, offsets, UTC midnight, lifecycle dates, year boundary, Amman's repeated midnight and Shanghai's mixed dates passed`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
