import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseDotStyle, normalizePulsePhase } from './pulsing-dot.ts';

test('pulse expands and fades linearly from start to end', () => {
  assert.deepEqual(pulseDotStyle(0), { radius: 15, alpha: 1 });
  assert.deepEqual(pulseDotStyle(0.5), { radius: 32.5, alpha: 0.5 });
  assert.deepEqual(pulseDotStyle(1), { radius: 50, alpha: 0 });
});

test('pulse phase is clamped to its animation interval', () => {
  assert.equal(normalizePulsePhase(-1), 0);
  assert.equal(normalizePulsePhase(2), 1);
});
