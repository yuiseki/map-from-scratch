import assert from 'node:assert/strict';
import test from 'node:test';
import { popupPointHitTest } from './map.ts';

test('point popup hit test uses a 13-pixel radius', () => {
  assert.equal(popupPointHitTest(0, 0), true);
  assert.equal(popupPointHitTest(5, 12), true);
  assert.equal(popupPointHitTest(13, 0), true);
  assert.equal(popupPointHitTest(13.01, 0), false);
});
