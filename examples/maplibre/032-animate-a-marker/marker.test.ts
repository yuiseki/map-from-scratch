import assert from 'node:assert/strict';
import test from 'node:test';
import { bounceOffset } from './marker.ts';

test('animated marker follows a periodic sine bounce with zero-height endpoints', () => {
  assert.equal(bounceOffset(0), 0);
  assert.equal(bounceOffset(350), 26);
  assert.ok(Math.abs(bounceOffset(700)) < 1e-12);
  assert.equal(bounceOffset(1050), 26);
  assert.equal(bounceOffset(1400), 0);
});
