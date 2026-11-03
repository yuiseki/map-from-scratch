import assert from 'node:assert/strict';
import test from 'node:test';
import { gradientPixels } from './gradient-icon.ts';

test('generated icon stores horizontal red, vertical green/blue and opaque alpha', () => {
  const pixels = gradientPixels(3);
  assert.deepEqual([...pixels.slice(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...pixels.slice(4, 8)], [85, 0, 0, 255]);
  assert.deepEqual([...pixels.slice(16, 20)], [85, 85, 85, 255]);
  assert.equal(pixels.length, 3 * 3 * 4);
});

test('zero-size generated icon has an empty pixel buffer', () => {
  assert.equal(gradientPixels(0).length, 0);
});
