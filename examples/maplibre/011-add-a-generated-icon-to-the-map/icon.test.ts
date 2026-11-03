import assert from 'node:assert/strict';
import test from 'node:test';
import { copyRedChannelToAlpha } from './icon.ts';

test('generated icon alpha copies red while leaving colour channels unchanged', () => {
  const pixels = new Uint8ClampedArray([255, 0, 0, 255, 128, 20, 240, 255, 0, 0, 255, 255]);
  copyRedChannelToAlpha(pixels);
  assert.deepEqual([...pixels], [255, 0, 0, 255, 128, 20, 240, 128, 0, 0, 255, 0]);
});

test('the alpha conversion handles an empty sprite buffer', () => {
  assert.doesNotThrow(() => copyRedChannelToAlpha(new Uint8ClampedArray()));
});
