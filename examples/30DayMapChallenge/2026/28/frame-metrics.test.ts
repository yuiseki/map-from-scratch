import assert from 'node:assert/strict';
import test from 'node:test';
import { frameIntervals } from './frame-metrics.ts';

test('frame intervals are differences between adjacent callback timestamps', () => {
  assert.deepEqual(frameIntervals([10, 27, 44, 61]), [17, 17, 17]);
});

test('fewer than two callbacks produce no frame intervals', () => {
  assert.deepEqual(frameIntervals([]), []);
  assert.deepEqual(frameIntervals([12]), []);
});
