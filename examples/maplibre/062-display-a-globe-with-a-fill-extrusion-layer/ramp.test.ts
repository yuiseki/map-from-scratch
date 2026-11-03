import assert from 'node:assert/strict';
import test from 'node:test';
import { STOPS, ramp, scaleT, heightOf, H_MIN, H_MAX, legendTicks } from './ramp.ts';

test('ramp hits viridis stops exactly and interpolates between them', () => {
  assert.deepEqual(ramp(0), STOPS[0]);
  assert.deepEqual(ramp(1), STOPS[STOPS.length - 1]);
  assert.deepEqual(ramp(0.5), STOPS[2]);
  const m = ramp(0.125);
  for (let k = 0; k < 3; k++) assert.equal(m[k], Math.round((STOPS[0][k] + STOPS[1][k]) / 2));
});

test('scale is the square root of the share of the largest population', () => {
  assert.equal(scaleT(1_000_000, 4_000_000), 0.5);
  assert.equal(scaleT(0, 4_000_000), 0);
  assert.equal(heightOf(4_000_000, 4_000_000), H_MIN + H_MAX);
  assert.equal(heightOf(0, 4_000_000), H_MIN);
  // A quarter of the population reaches half the height above the floor.
  assert.equal(heightOf(1_000_000, 4_000_000), H_MIN + H_MAX / 2);
});

test('the smallest extrusion stands above the sag of a 3 degree grid cell', () => {
  const sag = 1 - Math.cos((3 * Math.SQRT2 / 2) * Math.PI / 180);
  assert.ok(H_MIN > 3 * sag, `H_MIN ${H_MIN} vs sag ${sag}`);
});

test('legend ticks invert the scale: each tick population maps back to its t', () => {
  const ticks = legendTicks(1_400_000_000);
  assert.equal(ticks.length, 5);
  for (const { t, pop } of ticks) assert.ok(Math.abs(scaleT(pop, 1_400_000_000) - t) < 1e-9);
  assert.deepEqual(ticks.map((x) => x.t), [0, 0.25, 0.5, 0.75, 1]);
});
