import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { trustOnFirstUse, verifyActivity, validateOutbox } from '../../protocol/src/index.js';
import { buildIsland, DocumentError, OUTBOX_PAGE_SIZE, outboxPages } from '../src/index.js';
import { config, ORIGIN, records, signer } from './helpers.js';

const LEDGER = { unlocked: [] };
const FRIENDS = [{ id: 'https://neighbor.example', name: '邻居的岛', since: '2026-09-01' }];

async function build(list, extra = {}) {
  return buildIsland({ config: config(), records: list, friends: FRIENDS, ledger: LEDGER, signer: await signer(), sourceDate: '2026-10-01T00:00:00Z', ...extra });
}

describe('buildIsland', () => {
  test('a valid, signed set of documents', async () => {
    const list = records([
      { date: '2026-10-01', tags: ['桥'] },
      { kind: 'project', date: '2026-10-03', done: '2026-10-08', summary: '可审计的建模工作流' },
      { date: '2026-10-05', withdrawn: '2026-10-06' },
    ]);
    const island = await build(list);
    assert.equal(island.manifest.id, ORIGIN);
    assert.equal(island.manifest.updated, '2026-10-07T16:00:00Z'); // done 10-08 starts then in Asia/Shanghai
    assert.deepEqual(island.manifest.stats.records, { article: 1, note: 0, project: 1 });
    assert.deepEqual(island.manifest.stats.growth, { rules: 'default@0', points: 18, stage: 'seed', unlocked: [] });
    assert.equal(island.outbox.length, 1);
    const [page] = island.outbox;
    assert.equal(page.path, '/island/outbox.json');
    assert.deepEqual(page.document.items.map((item) => item.type), ['delete', 'post', 'post']);
    const del = page.document.items[0];
    assert.equal(del.id, `${ORIGIN}/records/r3/#withdrawn`);
    assert.deepEqual(del.object, { of: `${ORIGIN}/records/r3/` });
    assert.ok(!page.document.items.some((item) => item.id === `${ORIGIN}/records/r3/`));

    const history = await trustOnFirstUse(island.manifest, { now: '2026-10-15T00:00:00Z' });
    for (const item of page.document.items) {
      assert.deepEqual(await verifyActivity(history, item, { source: 'origin', delivery: false }), { ok: true });
    }
  });

  test('the same input gives byte-identical documents', async () => {
    const list = records([{ date: '2026-10-01' }, { kind: 'note', title: undefined, date: '2026-10-02' }]);
    assert.equal(JSON.stringify(await build(list)), JSON.stringify(await build(list)));
  });

  test('append-only additions leave old page bodies alone; the head snapshot changes', async () => {
    const make = (/** @type {number} */ n) =>
      records(Array.from({ length: n }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000) })));
    const before = await build(make(2 * OUTBOX_PAGE_SIZE + 3));
    const after = await build(make(2 * OUTBOX_PAGE_SIZE + 4));
    assert.deepEqual(before.outbox.map((page) => page.name), ['outbox-1', 'outbox-2', 'outbox']);
    assert.equal(JSON.stringify(after.outbox[0]), JSON.stringify(before.outbox[0]));
    assert.equal(JSON.stringify(after.outbox[1]), JSON.stringify(before.outbox[1]));
    assert.notEqual(after.outbox.at(-1).document.snapshot, before.outbox.at(-1).document.snapshot);
    const first = after.outbox[2].document;
    assert.equal(first.items.length, 4);
    assert.equal(first.next, `${ORIGIN}/island/outbox-2.json`);
    assert.equal(after.outbox[1].document.next, `${ORIGIN}/island/outbox-1.json`);
    assert.equal(after.outbox[0].document.next, undefined);
    for (const page of after.outbox) assert.ok(validateOutbox(page.document).valid);
    // Reading outbox.json and following next gives every activity, newest first.
    const all = [...after.outbox].reverse().flatMap((page) => page.document.items.map((item) => item.published));
    assert.equal(all.length, 2 * OUTBOX_PAGE_SIZE + 4);
    assert.deepEqual(all, [...all].sort().reverse());
  });

  test('updates of old posts move to the head; backdated additions and withdrawal change the snapshot', async () => {
    const input = Array.from({ length: 120 }, (_, i) => ({ date: new Date(Date.UTC(2026, 0, 1) + i * 86_400_000) }));
    const before = await build(records(input));
    assert.equal(before.outbox.at(-1).document.updated, '2026-10-01T00:00:00Z');
    const edited = await build(records(input.map((r, i) => i ? r : { ...r, title: '修改旧文章', updated: '2026-10-14' })));
    const head = edited.outbox.at(-1).document;
    assert.equal(head.items[0].object.title, '修改旧文章');
    assert.equal(head.items[0].updated, '2026-10-13T16:00:00Z');
    assert.notEqual(head.snapshot, before.outbox.at(-1).document.snapshot);
    const historicalEdit = await build(records(input.map((r, i) => i ? r : {
      ...r, title: '仍早于首页的修改', updated: '2026-01-01T01:00:00Z',
    })));
    assert.deepEqual(historicalEdit.outbox.at(-1).document.items, before.outbox.at(-1).document.items);
    assert.notEqual(historicalEdit.outbox.at(-1).document.snapshot, before.outbox.at(-1).document.snapshot);
    const backdated = await build(records([...input, { date: '2025-01-01' }]));
    assert.notEqual(backdated.outbox.at(-1).document.snapshot, before.outbox.at(-1).document.snapshot);
    assert.ok(backdated.outbox.flatMap((p) => p.document.items).some((i) => i.object.url?.endsWith('/r121/')));
    const withdrawn = await build(records(input.map((r, i) => i ? r : { ...r, withdrawn: '2026-10-14' })));
    assert.equal(withdrawn.outbox.at(-1).document.items[0].type, 'delete');
    assert.notEqual(withdrawn.outbox.at(-1).document.snapshot, before.outbox.at(-1).document.snapshot);
    for (const island of [before, edited, backdated, withdrawn]) {
      assert.match(island.outbox.at(-1).document.snapshot, /^[0-9a-f]{64}$/);
      for (const page of island.outbox) assert.ok(validateOutbox(page.document).valid);
    }
  });

  test('an island without records still has a valid empty outbox', async () => {
    const island = await build([]);
    assert.deepEqual(island.outbox[0].document.items, []);
    assert.equal(island.outbox[0].document.updated, '2026-10-01T00:00:00Z');
    assert.deepEqual(outboxPages([], ORIGIN, 'x').length, 1);
  });

  test('invalid friends fail the build with the reason', async () => {
    await assert.rejects(build([], { friends: [{ id: 'http://insecure.example', name: 'x' }] }), (error) => {
      assert.ok(error instanceof DocumentError);
      assert.match(error.message, /friends/);
      return true;
    });
  });
});
