import assert from 'node:assert/strict';
import test from 'node:test';
import { classOf, projectRoad, roadClassAt } from './road-data.ts';

test('highway tags map to the five rendered road classes', () => {
  assert.equal(classOf('motorway'), 0);
  assert.equal(classOf('trunk_link'), 0);
  assert.equal(classOf('primary'), 1);
  assert.equal(classOf('tertiary_link'), 2);
  assert.equal(classOf('residential'), 3);
  assert.equal(classOf('footway'), 4);
  assert.equal(classOf('unknown'), 4);
});

test('road coordinates quantize the Tokyo bounds into unsigned 16-bit grid space', () => {
  assert.deepEqual(projectRoad(139.50, 35.85), [0, 0]);
  const southeast = projectRoad(139.98, 35.48);
  assert.equal(southeast[0], 65535);
  assert.ok(southeast[1] > 60000 && southeast[1] < 65535);
  const [x, y] = projectRoad(139.74, 35.665);
  assert.ok(x > 32000 && x < 33500);
  assert.ok(y > 30000 && y < 32000);
  assert.deepEqual(projectRoad(120, 40), [0, 0]);
});

test('road vertex classes use 255 only as the final-segment sentinel', () => {
  assert.deepEqual([0, 1, 2].map((i) => roadClassAt(i, 3, 2)), [2, 2, 255]);
  assert.equal(roadClassAt(0, 1, 0), 255);
});
