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
  assert.equal(note.published, '2026-10-02T00:00:00Z');
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
