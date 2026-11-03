import test from 'node:test';
import assert from 'node:assert/strict';
import { createSphereMesh, computeSunDirection, isLandCoordinate, generateEarthTextures } from './globe.ts';

test('createSphereMesh generates valid sphere vertices, normals, UVs and triangle indices', () => {
  const mesh = createSphereMesh(16, 32, 1.0);
  assert.equal(mesh.positions.length, (16 + 1) * (32 + 1) * 3);
  assert.equal(mesh.normals.length, (16 + 1) * (32 + 1) * 3);
  assert.equal(mesh.uvs.length, (16 + 1) * (32 + 1) * 2);
  assert.equal(mesh.indices.length, 16 * 32 * 6);

  // Check radius of sample vertices
  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i];
    const y = mesh.positions[i + 1];
    const z = mesh.positions[i + 2];
    const r = Math.sqrt(x * x + y * y + z * z);
    assert.ok(Math.abs(r - 1.0) < 1e-4, `vertex radius must be 1.0, got ${r}`);

    const nx = mesh.normals[i];
    const ny = mesh.normals[i + 1];
    const nz = mesh.normals[i + 2];
    const nr = Math.sqrt(nx * nx + ny * ny + nz * nz);
    assert.ok(Math.abs(nr - 1.0) < 1e-4, `normal must be unit length, got ${nr}`);
  }

  // Top pole vertex should point along +Y
  assert.ok(Math.abs(mesh.normals[1] - 1.0) < 1e-4);
});

test('computeSunDirection returns normalized 3D direction vector', () => {
  const sun0 = computeSunDirection(0);
  const len0 = Math.hypot(sun0[0], sun0[1], sun0[2]);
  assert.ok(Math.abs(len0 - 1.0) < 1e-5);

  const sun1 = computeSunDirection(Math.PI / 2);
  const len1 = Math.hypot(sun1[0], sun1[1], sun1[2]);
  assert.ok(Math.abs(len1 - 1.0) < 1e-5);
  // Direction should change over time
  assert.notDeepEqual(sun0, sun1);
});

test('isLandCoordinate correctly classifies major continental vs oceanic locations', () => {
  // Sahara (Africa) should be land
  assert.equal(isLandCoordinate(20, 25), true);
  // Central North America should be land
  assert.equal(isLandCoordinate(-100, 40), true);
  // Tokyo, Japan area
  assert.equal(isLandCoordinate(139, 35), true);
  // Central Pacific Ocean should NOT be land
  assert.equal(isLandCoordinate(-160, 0), false);
  // South Pacific Ocean should NOT be land
  assert.equal(isLandCoordinate(-130, -30), false);
});

test('generateEarthTextures creates non-empty day and night texture buffers', () => {
  const { day, night } = generateEarthTextures(64, 32);
  assert.equal(day.length, 64 * 32 * 4);
  assert.equal(night.length, 64 * 32 * 4);

  // Day ocean pixel (Pacific) should have strong blue channel
  // lon -160 is roughly col index: (-160 + 180)/360 * 64 = 20/360*64 ~= 3.5 -> 3
  // lat 0 is row index: (90 - 0)/180 * 32 = 16
  const pacificIdx = (16 * 64 + 3) * 4;
  assert.ok(day[pacificIdx + 2] > day[pacificIdx]); // Blue > Red in ocean

  // Night city lights buffer should contain luminous pixels in populated areas
  let hasCityLights = false;
  for (let i = 0; i < night.length; i += 4) {
    if (night[i] > 100 || night[i + 1] > 100) {
      hasCityLights = true;
      break;
    }
  }
  assert.equal(hasCityLights, true);
});
