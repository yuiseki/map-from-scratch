import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNycCabTrips, buildTripsBuffer, MANHATTAN_CENTER } from './trips.ts';

test('generateNycCabTrips produces non-empty collection of timestamped routes', () => {
  const trips = generateNycCabTrips(80);
  assert.equal(trips.length, 80);

  for (const t of trips) {
    assert.ok(t.waypoints.length >= 4, 'Trip should have at least 4 waypoints');
    assert.ok(t.startTime >= 0 && t.endTime > t.startTime);

    for (const p of t.waypoints) {
      assert.ok(p.lon > -74.05 && p.lon < -73.90, `lon=${p.lon} outside Manhattan`);
      assert.ok(p.lat > 40.68 && p.lat < 40.82, `lat=${p.lat} outside Manhattan`);
      assert.ok(p.t >= t.startTime && p.t <= t.endTime);
    }
  }
});

test('buildTripsBuffer packs line segments into vertex buffer with timestamps', () => {
  const trips = generateNycCabTrips(20);
  const mesh = buildTripsBuffer(trips, MANHATTAN_CENTER);

  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length % 3, 0);
  assert.equal(mesh.timestamps.length, mesh.positions.length / 3);
  assert.equal(mesh.colors.length, mesh.positions.length);

  for (let i = 0; i < mesh.timestamps.length; i++) {
    assert.ok(!Number.isNaN(mesh.timestamps[i]), `NaN at timestamp ${i}`);
  }
});
