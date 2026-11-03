import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fallbackTiles, planTiles } from './tiles.ts';

test('visible tiles precede the central tiles of both neighboring zoom levels', () => {
  const plan = planTiles(17, 0.888321, 0.393675, true);
  assert.equal(plan.visible.length, 25);
  assert.equal(plan.prefetch.length, 18);
  assert.ok(plan.visible.every(tile => tile.z === 17));
  assert.deepEqual(plan.prefetch.map(tile => tile.z).slice(0, 9), Array(9).fill(18));
  assert.deepEqual(plan.prefetch.map(tile => tile.z).slice(9), Array(9).fill(16));
  assert.equal(new Set([...plan.visible, ...plan.prefetch].map(tile => `${tile.z}/${tile.x}/${tile.y}`)).size, 43);
});

test('outward zoom prefers lower resolution and bounds omit unavailable neighbors', () => {
  const outward = planTiles(17, 0.888321, 0.393675, false);
  assert.equal(outward.prefetch[0].z, 16);
  assert.equal(planTiles(14, 0.888321, 0.393675, true).prefetch.length, 9);
  assert.equal(planTiles(20, 0.888321, 0.393675, true).prefetch.length, 9);
});

test('missing visible tiles can use cached parent tiles without duplicates', () => {
  const missing = [{ z: 18, x: 232868, y: 103199 }, { z: 18, x: 232869, y: 103199 }];
  const cached = new Set(['17/116434/51599']);
  assert.deepEqual(fallbackTiles(missing, (z, x, y) => cached.has(`${z}/${x}/${y}`)),
    [{ z: 17, x: 116434, y: 51599 }]);
});
