import assert from 'node:assert/strict';
import test from 'node:test';
import { mercX, mercY } from './marker.ts';

test('marker longitude and latitude use normalized Web Mercator coordinates', () => {
  assert.equal(mercX(-180), 0);
  assert.equal(mercX(0), 0.5);
  assert.equal(mercX(180), 1);
  assert.equal(mercY(0), 0.5);
  assert.ok(mercY(45) < 0.5);
  assert.ok(mercY(-45) > 0.5);
});
