import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('open-modal map uses normalized Web Mercator coordinates', () => {
  assert.deepEqual(projectMercator(-180, 0), [0, 0.5]);
  assert.deepEqual(projectMercator(180, 0), [1, 0.5]);
  assert.ok(Number.isFinite(projectMercator(0, 90)[1]));
});
