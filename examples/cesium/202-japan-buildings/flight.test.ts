import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flight, groundDistance } from './flight.ts';
import type { Cam } from './geo.ts';

const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);
const kanto: Cam = { lat: 34.9, lon: 139.7, h: 120000, heading: 0, pitch: -45 };
const shinjuku: Cam = { lat: 35.6905, lon: 139.712, h: 450, heading: 270, pitch: -12 };

test('a flight starts and ends exactly at its two cameras', () => {
  const f = flight(kanto, shinjuku);
  assert.deepEqual(f.at(0), kanto);
  const end = f.at(1);
  for (const k of ['lat', 'lon', 'h', 'heading', 'pitch'] as const) near(end[k], shinjuku[k], 1e-9, k);
  assert.ok(f.ms >= 2000 && f.ms <= 7000, `duration ${f.ms}`);
});

test('the ground track follows the great circle: its midpoint is equidistant from both ends and on the shorter arc', () => {
  const a: Cam = { lat: 35.68, lon: 139.77, h: 1000, heading: 0, pitch: -30 };
  const b: Cam = { lat: 34.39, lon: 132.46, h: 1000, heading: 0, pitch: -30 };   // Hiroshima
  const f = flight(a, b), m = f.at(0.5);
  near(groundDistance(a, m), groundDistance(m, b), 1, 'equidistant');
  near(groundDistance(a, m) + groundDistance(m, b), groundDistance(a, b), 1, 'on the arc');
  // A great circle between two points at 35N bulges north of the parallel.
  assert.ok(m.lat > (a.lat + b.lat) / 2, `midpoint lat ${m.lat}`);
  // Uniform speed along the arc in eased time: where the ease reaches 1/4,
  // a quarter of the distance is flown (a straight chord renormalised would not).
  let lo = 0, hi = 1;
  for (let i = 0; i < 60; i++) { const u = (lo + hi) / 2; if (u * u * (3 - 2 * u) < 0.25) lo = u; else hi = u; }
  near(groundDistance(a, f.at(lo)), groundDistance(a, b) / 4, 50, 'quarter of the arc');
});

test('a long flight climbs above both ends; a zoom-in descends without climbing first', () => {
  const a: Cam = { lat: 35.68, lon: 139.77, h: 1000, heading: 0, pitch: -30 };
  const b: Cam = { lat: 34.39, lon: 132.46, h: 1000, heading: 0, pitch: -30 };
  const long = flight(a, b);
  assert.ok(long.at(0.5).h > 100000, `cruise ${long.at(0.5).h}`);
  const zoom = flight(kanto, { ...kanto, lat: 35.6, h: 2000 });
  let prev = Infinity;
  for (let i = 0; i <= 20; i++) {
    const h = zoom.at(i / 20).h;
    assert.ok(h <= prev + 1e-6, `height went up at step ${i}: ${prev} -> ${h}`);
    prev = h;
  }
  // Height is interpolated geometrically: halfway in time it is near the
  // geometric mean (sqrt(120 km x 2 km) = 15.5 km), not the arithmetic 61 km.
  assert.ok(zoom.at(0.5).h < 30000, `half-way height ${zoom.at(0.5).h}`);
});

test('heading turns the short way round, across north', () => {
  const f = flight({ ...shinjuku, heading: 350 }, { ...shinjuku, lat: 35.7, heading: 10 });
  const mid = f.at(0.5).heading;
  assert.ok(mid > 355 || mid < 5, `mid heading ${mid}`);
});

test('easing: the camera starts and ends at rest', () => {
  const f = flight(shinjuku, { ...shinjuku, lat: 35.66 });
  const d0 = groundDistance(f.at(0), f.at(0.01)), dm = groundDistance(f.at(0.5), f.at(0.51));
  assert.ok(d0 < dm / 20, `start speed ${d0} vs mid ${dm}`);
});
