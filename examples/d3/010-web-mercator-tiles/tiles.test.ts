import assert from 'node:assert/strict';
import test from 'node:test';
import { tileAddressFromWorld } from './tiles.ts';

test('world center maps to the middle Web Mercator tile', () => {
  assert.equal(tileAddressFromWorld(0.5, 0.5, 2), '2/2/2');
});

test('tile x wraps across world copies while y outside the world returns null', () => {
  assert.equal(tileAddressFromWorld(1, 0.5, 2), '2/0/2');
  assert.equal(tileAddressFromWorld(-0.01, 0.5, 2), '2/3/2');
  assert.equal(tileAddressFromWorld(0.5, -0.01, 2), null);
  assert.equal(tileAddressFromWorld(0.5, 1, 2), null);
});
