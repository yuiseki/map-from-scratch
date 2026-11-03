import assert from 'node:assert/strict';
import test from 'node:test';
import { geoToSphere, greatCircleRoute, flightPose, animationState } from './flight.ts';
import { rotateCamera, zoomDistance } from './globe.ts';

test('geographic coordinates map to a unit sphere', () => {
  assert.deepEqual(geoToSphere(0, 0), [0, 0, 1]);
  const east = geoToSphere(90, 0);
  assert.ok(Math.abs(east[0] - 1) < 1e-12 && Math.abs(east[2]) < 1e-12);
});

test('great-circle path contains both endpoints and unit-length intermediate positions', () => {
  const route = greatCircleRoute([-122, 38], [-74, 41], 32, 1);
  assert.equal(route.length, 33);
  assert.ok(Math.abs(route[0][0] - geoToSphere(-122, 38)[0]) < 1e-12);
  assert.ok(Math.abs(route[32][0] - geoToSphere(-74, 41)[0]) < 1e-12);
  for (const point of route) assert.ok(Math.abs(Math.hypot(...point) - 1) < 1e-6);
});

test('flight pose has orthonormal forward, wing and radial axes', () => {
  const pose = flightPose([-122, 38], [-74, 41], 0.5, 1.04);
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  for (const axis of [pose.forward, pose.right, pose.up]) assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-6);
  assert.ok(Math.abs(dot(pose.forward, pose.right)) < 1e-6);
  assert.ok(Math.abs(dot(pose.forward, pose.up)) < 1e-6);
  assert.ok(Math.abs(dot(pose.right, pose.up)) < 1e-6);
});

test('animation wraps route progress and cycles propeller and strobe phases', () => {
  const atStart = animationState(0);
  const afterOneLoop = animationState(atStart.durationSeconds * 1000);
  assert.equal(atStart.progress, 0);
  assert.equal(afterOneLoop.progress, 0);
  assert.ok(animationState(500).propellerAngle > 0);
  assert.ok(animationState(500).strobe > 0);
});

test('globe camera drag changes yaw and clamps pitch; wheel zoom stays in range', () => {
  const [yaw, pitch] = rotateCamera(0, 0, 100, 1000);
  assert.ok(yaw > 0);
  assert.equal(pitch, 1.15);
  assert.equal(zoomDistance(3, -1000), 2.55);
  assert.equal(zoomDistance(3, 2000), 5.5);
});
