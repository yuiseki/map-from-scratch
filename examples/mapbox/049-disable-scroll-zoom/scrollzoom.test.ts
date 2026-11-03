import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeDisabledScrollZoom } from './scrollzoom.ts';

test('disabled scroll zoom consumes the wheel event', () => {
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; } };
  consumeDisabledScrollZoom(event);
  assert.equal(prevented, true);
});
