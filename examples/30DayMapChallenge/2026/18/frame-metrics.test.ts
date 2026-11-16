import test from 'node:test';
import assert from 'node:assert/strict';
import { frameIntervals } from './frame-metrics.ts';

test('frame intervals use differences between adjacent RAF callback timestamps', () => {
  const intervals = frameIntervals([10, 26.7, 43.4, 60.1]);
  assert.equal(intervals.length, 3);
  for (const interval of intervals) assert.ok(Math.abs(interval - 16.7) < 1e-9);
});

test('fewer than two callback timestamps produce no interval samples', () => {
  assert.deepEqual(frameIntervals([]), []);
  assert.deepEqual(frameIntervals([12]), []);
});
