import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraViewProjection, orbitByDrag, zoomCamera, type OrbitCamera } from './camera.ts';

test('orbit drag changes azimuth and clamps pitch before the view can flip', () => {
  const start: OrbitCamera = { yaw: 40, pitch: 38, distance: 3.1 };
  assert.equal(orbitByDrag(start, 100, 30).yaw, 85);
  assert.equal(orbitByDrag(start, 0, -10000).pitch, 82);
  assert.equal(orbitByDrag(start, 0, 10000).pitch, 12);
});

test('wheel zoom is exponential and stays within the terrain framing range', () => {
  const start: OrbitCamera = { yaw: 0, pitch: 35, distance: 3 };
  assert.ok(zoomCamera(start, -100).distance < start.distance);
  assert.equal(zoomCamera(start, -100000).distance, 1.25);
  assert.equal(zoomCamera(start, 100000).distance, 8.5);
});

test('view-projection matrix is finite for portrait and landscape canvases', () => {
  const camera: OrbitCamera = { yaw: 40, pitch: 38, distance: 3.1 };
  for (const aspect of [0.5, 1, 2]) {
    const matrix = cameraViewProjection(camera, aspect);
    assert.equal(matrix.length, 16);
    assert.ok([...matrix].every(Number.isFinite));
  }
});
