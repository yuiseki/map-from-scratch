import assert from 'node:assert/strict';
import test from 'node:test';
import { opacityFromTrackX } from './overlay.ts';

test('opacity slider maps its endpoints and midpoint to percentages', () => {
  assert.equal(opacityFromTrackX(24), 0);
  assert.equal(opacityFromTrackX(131), 50);
  assert.equal(opacityFromTrackX(238), 100);
});

test('opacity slider clamps and rounds values outside and between endpoints', () => {
  assert.equal(opacityFromTrackX(-100), 0);
  assert.equal(opacityFromTrackX(131.4), 50);
  assert.equal(opacityFromTrackX(1000), 100);
});
