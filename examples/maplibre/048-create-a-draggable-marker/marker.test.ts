import assert from 'node:assert/strict';
import test from 'node:test';
import { markerHit } from './marker.ts';

test('draggable pin hit box includes its body and tip but excludes nearby points', () => {
  assert.equal(markerHit(100, 100, 100, 100), true);
  assert.equal(markerHit(84, 58, 100, 100), true);
  assert.equal(markerHit(116, 106, 100, 100), true);
  assert.equal(markerHit(81.9, 80, 100, 100), false);
  assert.equal(markerHit(100, 106.1, 100, 100), false);
});
