import assert from 'node:assert/strict';
import test from 'node:test';
import { subsolarPoint, sunDirection } from './sun.ts';

const near = (actual: number, expected: number, tolerance: number, what: string): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} is not within ${tolerance} of ${expected}`);
};

// Reference values: the 2026 June solstice is at 08:24 UTC on 21 June, when
// the declination equals the obliquity, 23.436 deg. The equation of time on
// that day is about -1.7 min, so the sun crosses Greenwich at 12:01.7 UTC and
// at 12:00 UTC it stands about 0.4 deg east of Greenwich.
test('subsolar point at the June solstice noon UTC is on the Tropic of Cancer near Greenwich', () => {
  const { lat, lon } = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 12, 0, 0)));
  near(lat, 23.436, 0.03, 'declination');
  near(lon, 0.42, 0.2, 'longitude');
});

test('subsolar point at the December solstice is on the Tropic of Capricorn', () => {
  // 2026-12-21 20:50 UTC; equation of time about +1.9 min.
  const { lat, lon } = subsolarPoint(new Date(Date.UTC(2026, 11, 21, 20, 50, 0)));
  near(lat, -23.436, 0.03, 'declination');
  near(lon, -15 * (20 + 50 / 60 - 12) - 15 * (1.9 / 60), 0.25, 'longitude');
});

test('the March equinox puts the sun on the equator', () => {
  // 2026-03-20 14:46 UTC.
  near(subsolarPoint(new Date(Date.UTC(2026, 2, 20, 14, 46, 0))).lat, 0, 0.03, 'declination');
});

test('the early-November equation of time moves noon about 16 minutes earlier', () => {
  // 3 November: equation of time +16.4 min, declination -15.1 deg.
  const { lat, lon } = subsolarPoint(new Date(Date.UTC(2026, 10, 3, 12, 0, 0)));
  near(lon, -15 * 16.4 / 60, 0.1, 'longitude');
  near(lat, -15.1, 0.2, 'declination');
});

test('the subsolar longitude moves west 15 deg per hour and wraps into [-180, 180)', () => {
  const t0 = Date.UTC(2026, 5, 21, 12, 0, 0);
  const a = subsolarPoint(new Date(t0)).lon;
  const b = subsolarPoint(new Date(t0 + 3600_000)).lon;
  near(a - b, 15, 0.01, 'hourly motion');
  const midnight = subsolarPoint(new Date(Date.UTC(2026, 5, 21, 0, 0, 0))).lon;
  assert.ok(midnight >= -180 && midnight < 180, `wrapped longitude ${midnight}`);
  near(Math.abs(midnight), 179.6, 0.3, 'longitude at midnight UTC');
});

test('sun direction is the unit vector of the subsolar point in the globe frame (lon 0 = +Z, north = +Y, 90E = +X)', () => {
  const date = new Date(Date.UTC(2026, 5, 21, 6, 0, 0));
  const { lat, lon } = subsolarPoint(date);
  const [x, y, z] = sunDirection(date);
  near(Math.hypot(x, y, z), 1, 1e-12, 'length');
  near(Math.asin(y) * 180 / Math.PI, lat, 1e-9, 'latitude from y');
  near(Math.atan2(x, z) * 180 / Math.PI, lon, 1e-9, 'longitude from x and z');
  assert.ok(x > 0.8, 'at 06 UTC the sun is over the Indian Ocean, east of Greenwich');
});
