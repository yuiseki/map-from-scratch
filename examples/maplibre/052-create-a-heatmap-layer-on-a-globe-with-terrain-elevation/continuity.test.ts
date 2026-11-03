import test from 'node:test';
import assert from 'node:assert/strict';
import { jumpSteps } from './continuity.ts';

// mean |dL| per 0.25 zoom step from 9 to 0.5 at the opening view (RTX 3060, 2026-11-03).
const MEASURED = [9.8, 8.0, 6.7, 5.3, 4.3, 3.8, 3.3, 3.0, 2.9, 2.8, 2.6, 2.5, 2.5, 2.7, 3.1, 3.1, 3.0, 2.8, 2.8, 2.7,
  2.8, 2.7, 2.9, 3.2, 3.4, 3.4, 3.4, 3.2, 21.4, 22.5, 23.7, 25.5, 27.4, 28.0];

test('the atmosphere fade of the original (zoom 2 to 0) is not a jump', () => {
  assert.deepEqual(jumpSteps(MEASURED), []);
});

test('one frame that changes far more than both its neighbours is a jump, wherever it is', () => {
  const spike = [...MEASURED];
  spike[12] = 20;                         // a level or mesh switch at zoom 6
  assert.deepEqual(jumpSteps(spike), [12]);
  assert.deepEqual(jumpSteps([30, 3, 3, 3]), [0]);
  assert.deepEqual(jumpSteps([3, 3, 3, 40]), [3]);
  // A sudden change in the middle of the fade too.
  const inFade = [...MEASURED];
  inFade[30] = 90;
  assert.deepEqual(jumpSteps(inFade), [30]);
});
