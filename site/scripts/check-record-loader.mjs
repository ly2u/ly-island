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
  settings.timeZone = 'America/Los_Angeles';
  writeFileSync(join(site, 'island.config.json'), JSON.stringify(settings));
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
  console.log(`record loader: ${cases} failing-build cases rejected; leap day, date-only, offsets, UTC midnight, lifecycle dates and year boundary passed`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
