import assert from 'node:assert/strict';
import test from 'node:test';
import { projectMercator } from './map.ts';

test('Tangram road map uses normalized Web Mercator coordinates', () => {
  assert.deepEqual(projectMercator(0, 0), [0.5, 0.5]);
  assert.equal(projectMercator(-180, 0)[0], 0);
  assert.equal(projectMercator(180, 0)[0], 1);
});
