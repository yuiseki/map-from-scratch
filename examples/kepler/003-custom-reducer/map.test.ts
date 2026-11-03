import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('custom-reducer map projection keeps x normalized and y increasing southward', () => {
  assert.deepEqual(projectMercator(0, 0), [0.5, 0.5]);
  assert.ok(projectMercator(0, 30)[1] < 0.5);
  assert.ok(projectMercator(0, -30)[1] > 0.5);
});
