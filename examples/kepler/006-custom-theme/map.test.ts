import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('custom-theme map projection is centered and monotonic in latitude', () => {
  assert.deepEqual(projectMercator(0, 0), [0.5, 0.5]);
  assert.ok(projectMercator(0, 60)[1] < projectMercator(0, 30)[1]);
});
