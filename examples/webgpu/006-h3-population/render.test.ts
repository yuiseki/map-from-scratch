import assert from 'node:assert/strict';
import test from 'node:test';
import { populationColor, populationHeight } from './render.ts';

test('population color and height handle zero, increase with population and stay bounded', () => {
  assert.deepEqual(populationColor(0), [0.1, 0.18, 0.24]);
  assert.equal(populationHeight(0), 0.001);
  assert.ok(populationHeight(1000) > populationHeight(10));
  for (const value of [1, 1_000, 1_000_000, 10_000_000]) {
    assert.ok(populationColor(value).every((channel) => channel >= 0 && channel <= 1));
    assert.ok(populationHeight(value) <= 0.085);
  }
});
