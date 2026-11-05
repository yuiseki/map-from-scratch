import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRingInstances } from './webgl.ts';
import type { EarthquakeEvent } from './field.ts';

const event = (id: string, longitude: number, latitude: number, magnitude: number, depthKm: number, time: number): EarthquakeEvent =>
  ({ id, longitude, latitude, magnitude, depthKm, time });
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test('packs three source-positioned ring instances per event in chronological order', () => {
  const events = [event('a', -180, 0, 4.5, 12, 10), event('b', 90, -45, 8.8, 400, 20)];
  const rows = buildRingInstances(events);
  assert.equal(rows.length, 2 * 3 * 9);
  [-0.5, 0.5, 2, 0.18, 46 / 255, 245 / 255, 202 / 255, 0.38, 0].forEach((value, i) => close(rows[i]!, value));
  [-0.5, 0.5, 2, 0.18, 46 / 255, 245 / 255, 202 / 255, 0.69, 0].forEach((value, i) => close(rows[i + 9]!, value));
  assert.equal(rows[17], 0);
  assert.equal(rows[18], -0.5);
  close(rows[27]!, 0.25);
  assert.equal(rows[35], 1);
  close(rows[28]!, 0.625);
  close(rows[29]!, 11);
  [205 / 255, 116 / 255, 255 / 255].forEach((value, i) => close(rows[i + 31]!, value));
});

test('empty snapshots produce an empty instance buffer', () => {
  assert.equal(buildRingInstances([]).length, 0);
});
