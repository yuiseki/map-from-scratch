import assert from 'node:assert/strict';
import test from 'node:test';
import { bounceOffset } from './marker.ts';

test('marker bounce starts and ends at the anchor and reaches full height halfway', () => {
  assert.equal(bounceOffset(0), 0);
  assert.equal(bounceOffset(350), 26);
  assert.ok(Math.abs(bounceOffset(700)) < 1e-12);
});

test('bounce animation wraps continuously through repeated cycles', () => {
  assert.equal(bounceOffset(1050), bounceOffset(350));
});
