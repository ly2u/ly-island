import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CAPS, islandScene } from '../src/index.js';

const input = { seed: 'demo', colors: ['#6fa8dc', '#f6b26b'], counts: { article: 3, note: 12, project: 2 }, done: 1, unlocked: ['stage-growing'] };
const shapes = (/** @type {ReturnType<typeof islandScene>} */ scene) => [...scene.background, ...scene.island, scene.fog];

test('the same seed draws the same island; another seed draws another', () => {
  assert.equal(JSON.stringify(islandScene(input)), JSON.stringify(islandScene(structuredClone(input))));
  assert.notEqual(JSON.stringify(islandScene({ ...input, seed: 'other' }).island), JSON.stringify(islandScene(input).island));
});

test('records become trees, houses and towers, up to the caps', () => {
  assert.deepEqual(islandScene(input).drawn, { trees: 12, houses: 3, towers: 2, decorations: [] });
  const busy = islandScene({ ...input, counts: { article: 100, note: 500, project: 50 }, unlocked: ['stage-flourishing'] }).drawn;
  assert.ok(busy.trees <= CAPS.trees && busy.houses <= CAPS.houses && busy.towers <= CAPS.towers);
  assert.ok(busy.trees >= CAPS.trees * 0.6, JSON.stringify(busy));
});

test('unlocks grow the island and add known decorations; unknown ones are ignored', () => {
  assert.equal(islandScene({ ...input, unlocked: [] }).size, 'seed');
  const grown = islandScene({ ...input, unlocked: ['stage-growing', 'stage-flourishing', 'windmill', 'from-another-theme'] });
  assert.equal(grown.size, 'flourishing');
  assert.deepEqual(grown.drawn.decorations, ['windmill']);
});

test('every shape is a plain SVG primitive with finite numbers and hex colors', () => {
  for (const scene of [islandScene(input), islandScene({ ...input, seed: '', counts: {}, unlocked: ['lantern', 'windmill', 'lighthouse-small', 'bridge', 'observatory', 'stage-flourishing'] })]) {
    for (const shape of shapes(scene)) {
      assert.ok(['polygon', 'ellipse', 'circle', 'rect'].includes(shape.tag));
      for (const [name, value] of Object.entries(shape.attributes)) {
        assert.match(name, /^(points|fill|opacity|class|x|y|width|height|cx|cy|r|rx|ry)$/);
        if (name === 'points') assert.match(String(value), /^-?\d+(\.\d)?,-?\d+(\.\d)?( -?\d+(\.\d)?,-?\d+(\.\d)?)*$/);
        else if (name === 'fill') assert.match(String(value), /^#[0-9a-f]{6}$/);
        else if (name !== 'class') assert.ok(Number.isFinite(value), `${name}=${value}`);
      }
    }
  }
});
