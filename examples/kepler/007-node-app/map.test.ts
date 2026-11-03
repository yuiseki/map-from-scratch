import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';
test('Node-app map projection returns a unit-world point for ordinary coordinates', () => {
  const [x, y] = projectMercator(139.7, 35.6);
  assert.ok(x > 0 && x < 1 && y > 0 && y < 1);
});
