import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { defaultRules, mergeLedger, presentStats, rulesFor } from '../src/index.js';

const { accumulate, checkConfig, pointsOn, present, unlocksFor } = defaultRules;
const EMPTY = { unlocked: [] };
const at = (/** @type {string} */ date, kind = 'article', extra = {}) => ({ kind, date, ...extra });

describe('accumulate (build time)', () => {
  test('points: notes at most 3 a day, articles 3, projects 5 plus 10 when done', () => {
    const facts = [
      ...Array.from({ length: 5 }, () => at('2026-10-01', 'note')),
      at('2026-10-02', 'note'),
      at('2026-10-02'),
      at('2026-10-03', 'project'),
      at('2026-10-04', 'project', { done: '2026-10-10' }),
    ];
    assert.equal(pointsOn(facts, '9999-12-31'), 3 + 1 + 3 + 5 + 15);
    assert.equal(pointsOn(facts, '2026-10-09'), 3 + 1 + 3 + 5 + 5);
  });

  test('stages and unlocks', () => {
    assert.deepEqual(unlocksFor(29), []);
    assert.deepEqual(unlocksFor(30), ['stage-growing']);
    assert.deepEqual(unlocksFor(199), ['stage-growing', 'stage-flourishing']);
    assert.deepEqual(unlocksFor(300), ['stage-growing', 'stage-flourishing', 'lantern', 'windmill']);
    assert.deepEqual(unlocksFor(700).slice(-2), ['observatory', 'decoration-6']);
    assert.equal(unlocksFor(799).length, 2 + 6);
    const ten = Array.from({ length: 10 }, (_, i) => at(`2026-10-${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual(accumulate({ records: ten, ledger: EMPTY }), {
      points: 30,
      stage: 'growing',
      unlocked: ['stage-growing'],
      next: { stage: 'flourishing', points: 100 },
    });
  });

  test('acceptance: withdrawing after a threshold keeps the unlock, points drop', () => {
    const facts = Array.from({ length: 10 }, (_, i) => at(`2026-10-${String(i + 1).padStart(2, '0')}`));
    facts[9] = at('2026-10-10', 'article', { withdrawn: '2026-10-12' });
    const state = accumulate({ records: facts, ledger: EMPTY });
    assert.equal(state.points, 27);
    assert.equal(state.stage, 'seed');
    assert.deepEqual(state.unlocked, ['stage-growing']);
  });

  test('same-day withdrawal keeps the previous build\'s unlock without saving a ledger', () => {
    const facts = Array.from({ length: 10 }, () => at('2026-10-14'));
    const before = accumulate({ records: facts, ledger: EMPTY });
    const after = accumulate({ records: facts.map((r, i) => i ? r : { ...r, withdrawn: r.date }), ledger: EMPTY });
    assert.equal(before.points, 30);
    assert.equal(after.points, 27);
    assert.deepEqual(after.unlocked, before.unlocked);
    assert.deepEqual(after.unlocked, ['stage-growing']);
  });

  test('same-day project completion and withdrawal retains its unlock, not its points', () => {
    const project = at('2026-10-14', 'project', { done: '2026-10-14' });
    const config = { growingAt: 15 };
    const before = accumulate({ records: [project], ledger: EMPTY }, config);
    const after = accumulate({ records: [{ ...project, withdrawn: project.date }], ledger: EMPTY }, config);
    assert.equal(before.points, 15);
    assert.equal(after.points, 0);
    assert.deepEqual(after.unlocked, before.unlocked);
    assert.deepEqual(after.unlocked, ['stage-growing']);
  });

  test('acceptance: rebuilding from scratch gives the same result (no hidden state)', () => {
    const facts = [at('2026-10-01'), at('2026-10-02', 'project', { done: '2026-10-03' })];
    assert.deepEqual(accumulate({ records: facts, ledger: EMPTY }), accumulate({ records: structuredClone(facts), ledger: { unlocked: [] } }));
  });

  test('acceptance: the ledger keeps unlocks after record files are deleted or rules change', () => {
    const facts = Array.from({ length: 10 }, (_, i) => at(`2026-10-${String(i + 1).padStart(2, '0')}`));
    const before = accumulate({ records: facts, ledger: EMPTY });
    const { ledger, added } = mergeLedger(EMPTY, before.unlocked, 'default@0', '2026-10-15');
    assert.deepEqual(added, ['stage-growing']);
    // The files are gone, or another rule set no longer reaches the threshold.
    const after = accumulate({ records: facts.slice(0, 2), ledger });
    assert.equal(after.points, 6);
    assert.deepEqual(after.unlocked, ['stage-growing']);
    // Saving again adds nothing and keeps the original date.
    const again = mergeLedger(ledger, after.unlocked, 'default@0', '2026-11-01');
    assert.deepEqual(again.added, []);
    assert.equal(again.ledger.unlocked[0].since, '2026-10-15');
  });

  test('unknown ledger entries are kept; bad ledgers and settings are errors', () => {
    const ledger = { unlocked: [{ id: 'old-theme-thing', since: '2026-01-01', rules: 'other@1' }] };
    assert.deepEqual(accumulate({ records: [], ledger }).unlocked, ['old-theme-thing']);
    assert.throws(() => accumulate({ records: [], ledger: { unlocked: [{ id: 'X', since: '2026-01-01', rules: 'r' }] } }), /bad id/);
    assert.throws(() => accumulate({ records: [], ledger: {} }), /must be a list/);
    assert.throws(() => checkConfig({ articlePoints: 0 }), /whole number/);
    assert.throws(() => checkConfig({ bonus: 1 }), /unknown growth setting/);
    assert.throws(() => checkConfig({ growingAt: 100, flourishingAt: 50 }), /greater/);
    assert.equal(accumulate({ records: [at('2026-10-01')], ledger: EMPTY }, { articlePoints: 30 }).stage, 'growing');
  });
});

describe('present (browser)', () => {
  const stats = (/** @type {string[]} */ activeWeeks, lastRecord = undefined, growth = { rules: 'default@0', points: 40, stage: 'growing', unlocked: ['stage-growing'] }) => ({
    activeWeeks,
    ...(lastRecord ? { lastRecord } : {}),
    growth,
  });

  test('a streak ends this week, or last week while this week is still empty', () => {
    const weeks = ['2026-W38', '2026-W39', '2026-W40', '2026-W41'];
    assert.equal(present(stats(weeks, '2026-10-09'), '2026-10-14').streakWeeks, 4); // W42, nothing yet
    assert.equal(present(stats([...weeks, '2026-W42'], '2026-10-14'), '2026-10-14').streakWeeks, 5);
    assert.equal(present(stats(weeks, '2026-10-09'), '2026-10-21').streakWeeks, 0); // W43: W42 was missed
  });

  test('longest run and vitality', () => {
    const view = present(stats(['2026-W30', '2026-W31', '2026-W32', '2026-W40'], '2026-09-29'), '2026-10-14');
    assert.equal(view.longestWeeks, 3);
    assert.equal(view.vitality, 0.6); // last record in W40, today W42
    const vitality = (/** @type {string} */ today) => present(stats(['2026-W40'], '2026-09-29'), today).vitality;
    assert.deepEqual(['2026-09-30', '2026-10-07', '2026-10-14', '2026-10-21', '2026-10-28', '2026-11-25', '2027-06-01'].map(vitality), [1, 1, 0.6, 0.6, 0.3, 0.1, 0.1]);
    assert.equal(present({}, '2026-10-14').vitality, 0.6);
  });

  test('untrusted stats from other islands do not break anything', () => {
    for (const bad of [null, 'x', { activeWeeks: 'W1' }, { activeWeeks: ['2026-W99', 7, null], lastRecord: '2026-02-30', growth: { points: -5, stage: 9, unlocked: [1, 'a'.repeat(100), 'ok'] } }]) {
      const view = present(bad, '2026-10-14');
      assert.equal(view.points, 0);
      assert.ok(view.vitality > 0 && view.vitality <= 1);
      assert.ok(view.unlocked.every((item) => item === 'ok'));
    }
    assert.throws(() => present({}, '2026-10-32'), RangeError);
  });

  test('unknown rules fall back to default@0', () => {
    for (const rules of ['someone-else@3', '__proto__', 'constructor', 'toString', null, {}, []]) {
      assert.equal(presentStats({ growth: { rules, points: 5, stage: 'seed' } }, '2026-10-14').points, 5);
    }
    for (const id of ['__proto__', 'constructor', 'toString']) assert.throws(() => rulesFor(id), /unknown growth rules/);
  });
});
