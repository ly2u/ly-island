import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeRecords, plainText, publicRecords, RecordError, recordStats } from '../src/index.js';
import { ORIGIN, records } from './helpers.js';

const options = { origin: ORIGIN, timeZone: 'Asia/Shanghai', language: 'zh-CN' };

test('records are normalized, newest first, and drafts are left out', () => {
  const list = normalizeRecords(
    [
      { slug: 'old', kind: 'article', title: '旧', date: new Date('2026-09-01T00:00:00Z'), html: '<p>a</p>' },
      { slug: 'draft', kind: 'article', title: '草稿', date: '2026-10-10', draft: true },
      { slug: 'new', kind: 'note', date: '2026-10-02', summary: '一句话也算一次记录。', tags: ['日常'], html: '<p>雨停了</p>' },
    ],
    options,
  );
  assert.deepEqual(list.map((r) => r.slug), ['new', 'old']);
  const note = list[0];
  assert.equal(note.url, `${ORIGIN}/records/new/`);
  assert.equal(note.title, undefined);
  assert.equal(note.displayTitle, '一句话也算一次记录。');
  assert.equal(note.published, '2026-10-01T16:00:00Z'); // the start of 10-02 in Asia/Shanghai
  assert.equal(note.language, 'zh-CN');
  assert.equal(note.text, '雨停了');
});

test('every problem is reported at once', () => {
  assert.throws(
    () =>
      normalizeRecords(
        [
          { slug: 'Bad Name', kind: 'article', title: 'x', date: '2026-10-01' },
          { slug: 'a', kind: 'blog', title: 'x', date: '2026-10-01' },
          { slug: 'b', kind: 'article', date: '2026-10-01' },
          { slug: 'c', kind: 'article', title: 'x', date: '2026-10-05', done: '2026-10-06', withdrawn: '2026-10-04' },
          { slug: 'd', kind: 'project', title: 'x', date: '2026-10-05', done: '2026-10-01' },
          { slug: 'e', kind: 'article', title: 'x', date: '2026-10-01', tags: ['', 'ok'] },
          { slug: 'e', kind: 'article', title: 'x' },
        ],
        options,
      ),
    (error) => {
      assert.ok(error instanceof RecordError);
      const text = error.problems.join('\n');
      for (const expected of ['Bad Name: the file name', 'a: kind must be', 'b: only notes may leave out the title', 'c: only projects can be done', 'c: withdrawn cannot be before date', 'd: done cannot be before date', 'e: tags must be', 'e: another record has the same file name', 'e: date is required']) {
        assert.ok(text.includes(expected), `${expected}\n${text}`);
      }
      return true;
    },
  );
});

test('withdrawn records are not public and not counted in the statistics', () => {
  const list = records([
    { date: '2026-09-28' },
    { date: '2026-10-05', withdrawn: '2026-10-06' },
    { kind: 'note', title: undefined, date: '2026-10-07' },
  ]);
  assert.equal(publicRecords(list).length, 2);
  assert.deepEqual(recordStats(list), {
    records: { article: 1, note: 1, project: 0 },
    firstRecord: '2026-09-28',
    lastRecord: '2026-10-07',
    activeWeeks: ['2026-W40', '2026-W41'],
  });
});

test('statistics keep the latest 60 active weeks', () => {
  const list = records(Array.from({ length: 70 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 6 + i * 7)) })));
  const { activeWeeks } = recordStats(list);
  assert.equal(activeWeeks.length, 60);
  assert.equal(activeWeeks[0], '2025-W12');
  assert.equal(activeWeeks.at(-1), '2026-W19');
});

test('plain text from HTML', () => {
  assert.equal(plainText('<p>A &amp; B</p><script>x()</script><p>&#x4E2D;&lt;b&gt;</p>'), 'A & B 中<b>');
});

test('instants are converted consistently for records, weeks, completion and withdrawal', () => {
  const list = normalizeRecords([
    { slug: 'date-only', kind: 'project', title: '日历日期', date: '2026-10-05' },
    { slug: 'instant', kind: 'project', title: 'UTC 零点', date: '2026-10-05T00:00:00Z', done: '2026-10-05T01:00:00Z' },
    { slug: 'gone', kind: 'article', title: '已撤回', date: '2026-10-03', withdrawn: '2026-10-05T00:00:00Z' },
  ], { ...options, timeZone: 'America/Los_Angeles' });
  const instant = list.find((r) => r.slug === 'instant');
  assert.equal(instant.date, '2026-10-04');
  assert.equal(instant.done, '2026-10-04');
  assert.equal(instant.doneAt, '2026-10-05T01:00:00Z');
  assert.equal(list.find((r) => r.slug === 'date-only').date, '2026-10-05');
  assert.equal(list.find((r) => r.slug === 'gone').withdrawn, '2026-10-04');
  assert.equal(list.find((r) => r.slug === 'gone').withdrawnAt, '2026-10-05T00:00:00Z');
  assert.deepEqual(recordStats(list).activeWeeks, ['2026-W40', '2026-W41']);
  assert.throws(() => records([{ slug: 'trailing-newline\n' }]), /file name/);
});

test('a date without a time is that whole local day', () => {
  const one = (/** @type {Record<string, unknown>} */ extra) =>
    normalizeRecords([{ slug: 'a', kind: 'project', title: 't', html: '<p>x</p>', ...extra }], options)[0];
  // Timed date, date-only lifecycle fields on the same day: allowed, and never before the record.
  const timed = one({ date: '2026-10-05T20:00:00+08:00', done: '2026-10-05', withdrawn: '2026-10-05' });
  assert.equal(timed.published, '2026-10-05T12:00:00Z');
  assert.equal(timed.doneAt, '2026-10-05T12:00:00Z');
  assert.equal(timed.withdrawnAt, '2026-10-05T12:00:00Z');
  // Date-only date, an early-morning time on the same local day: allowed and later.
  const morning = one({ date: '2026-10-05', withdrawn: '2026-10-05T07:00:00+08:00', updated: '2026-10-05T06:00:00+08:00' });
  assert.equal(morning.published, '2026-10-04T16:00:00Z');
  assert.equal(morning.withdrawnAt, '2026-10-04T23:00:00Z');
  assert.equal(morning.updated, '2026-10-04T22:00:00Z');
  // Really earlier, or an update receivers could not see: errors that say what to do.
  assert.throws(() => one({ date: '2026-10-05T20:00:00+08:00', withdrawn: '2026-10-05T19:00:00+08:00' }), /withdrawn cannot be before date/);
  assert.throws(() => one({ date: '2026-10-05T20:00:00+08:00', done: '2026-10-04' }), /done cannot be before date/);
  assert.throws(() => one({ date: '2026-10-05T20:00:00+08:00', updated: '2026-10-05' }), /updated must be later than date; on the same day, write a time/);
  assert.throws(() => one({ date: '2026-10-05', updated: '2026-10-05' }), /updated must be later than date/);
  assert.throws(() => one({ date: '2026-10-05', updated: '2026-10-04' }), /updated cannot be before date/);
});

test('days at clock changes: the first midnight counts, and a skipped day is an error', () => {
  const at = (/** @type {string} */ timeZone, /** @type {Record<string, unknown>} */ extra) =>
    normalizeRecords([{ slug: 'a', kind: 'article', title: 't', html: '<p>x</p>', ...extra }], { ...options, timeZone })[0];
  // Amman: 00:30 in the first hour of 2021-10-29 is after the day began.
  const amman = at('Asia/Amman', { date: '2021-10-29', updated: '2021-10-29T00:30:00+03:00' });
  assert.equal(amman.published, '2021-10-28T21:00:00Z');
  assert.equal(amman.updated, '2021-10-28T21:30:00Z');
  // Samoa skipped 2011-12-30: reported with the other problems, not signed as the next day.
  assert.throws(
    () => at('Pacific/Apia', { date: '2011-12-30' }),
    (error) => error instanceof RecordError && /a: date: 2011-12-30 does not exist in Pacific\/Apia/.test(error.problems.join('\n')),
  );
  assert.throws(() => at('Pacific/Apia', { date: '2011-12-29', withdrawn: '2011-12-30' }), /withdrawn: 2011-12-30 does not exist/);
});
