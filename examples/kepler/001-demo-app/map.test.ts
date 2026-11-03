import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('Kepler demo map projects the prime meridian and equator to world center', () => {
  assert.deepEqual(projectMercator(0, 0), [0.5, 0.5]);
  assert.ok(projectMercator(90, 0)[0] > 0.5);
  assert.ok(projectMercator(0, 45)[1] < 0.5);
});
