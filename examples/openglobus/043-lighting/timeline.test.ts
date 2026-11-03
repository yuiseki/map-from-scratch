import assert from 'node:assert/strict';
import test from 'node:test';
import { PLAY_HOURS_PER_SECOND, advance, formatUtc, minuteOfDay, withMinute } from './timeline.ts';

const T = Date.UTC(2026, 5, 21, 12, 0, 0);

test('playing advances simulated time by hours per wall-clock second', () => {
  assert.equal(advance(T, 0.2, 2), T + 0.4 * 3600_000);
  assert.equal(advance(T, 0.1, 4), T + 0.4 * 3600_000);
  assert.equal(advance(T, 0, 2), T);
});

test('a day of play takes between 5 and 30 seconds, long enough to watch the terminator sweep', () => {
  const seconds = 24 / PLAY_HOURS_PER_SECOND;
  assert.ok(seconds >= 5 && seconds <= 30, `${seconds} s per day`);
});

test('a long frame gap does not jump more than a quarter of a second of play', () => {
  assert.equal(advance(T, 10, 2), advance(T, 0.25, 2));
});

test('the time slider reads and sets the UTC minute of the day without changing the date', () => {
  assert.equal(minuteOfDay(T), 720);
  assert.equal(minuteOfDay(Date.UTC(2026, 5, 21, 23, 59, 30)), 1439);
  const moved = withMinute(T, 90);
  assert.equal(new Date(moved).toISOString(), '2026-06-21T01:30:00.000Z');
  assert.equal(minuteOfDay(advance(Date.UTC(2026, 5, 21, 23, 50), 0.25, 2)), 20, 'play rolls over midnight');
});

test('time is shown in UTC', () => {
  assert.equal(formatUtc(T), '2026-06-21 12:00 UTC');
  assert.equal(formatUtc(Date.UTC(2026, 0, 2, 3, 4, 59)), '2026-01-02 03:04 UTC');
});
