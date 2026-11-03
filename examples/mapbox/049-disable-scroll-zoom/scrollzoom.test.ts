import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDisabledScrollZoom } from './scrollzoom.ts';

test('disabled scroll zoom consumes the wheel event without changing camera state', () => {
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  const camera = { zoom: 3 };
  consumeDisabledScrollZoom(event);
  assert.equal(prevented, true);
  assert.equal(camera.zoom, 3);
});
