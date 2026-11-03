import assert from 'node:assert/strict';
import test from 'node:test';
import { markerHitTest } from './marker.ts';

test('draggable marker hit test includes its pin rectangle and small tolerance', () => {
  assert.equal(markerHitTest(0, -46), true);
  assert.equal(markerHitTest(18, 6), true);
  assert.equal(markerHitTest(19, 0), false);
  assert.equal(markerHitTest(0, 7), false);
});
