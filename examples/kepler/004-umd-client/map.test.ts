import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('UMD-client map projection wraps the equator at half-world y', () => {
  assert.equal(projectMercator(-90, 0)[0], 0.25);
  assert.equal(projectMercator(90, 0)[0], 0.75);
  assert.equal(projectMercator(0, 0)[1], 0.5);
});
