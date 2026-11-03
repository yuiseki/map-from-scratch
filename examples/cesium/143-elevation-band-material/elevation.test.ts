import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateMountainTerrain,
  computeElevationBandColor,
  DEFAULT_ELEVATION_BANDS,
  type ElevationBand,
} from './elevation.ts';

test('generateMountainTerrain creates valid 3D terrain grid mesh', () => {
  const grid = 32;
  const maxHeight = 3776; // Mt Fuji height
  const mesh = generateMountainTerrain(grid, maxHeight);

  const expectedVertices = (grid + 1) * (grid + 1);
  assert.equal(mesh.positions.length, expectedVertices * 3);
  assert.equal(mesh.normals.length, expectedVertices * 3);
  assert.equal(mesh.elevations.length, expectedVertices);
  assert.equal(mesh.indices.length, grid * grid * 6);

  // Check summit elevation is close to maxHeight
  let maxObserved = 0;
  for (let i = 0; i < mesh.elevations.length; i++) {
    if (mesh.elevations[i] > maxObserved) maxObserved = mesh.elevations[i];
  }
  assert.ok(maxObserved >= maxHeight * 0.95 && maxObserved <= maxHeight * 1.05);

  // Normals are normalized unit vectors
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const nx = mesh.normals[i];
    const ny = mesh.normals[i + 1];
    const nz = mesh.normals[i + 2];
    const len = Math.hypot(nx, ny, nz);
    assert.ok(Math.abs(len - 1.0) < 1e-4, `normal must be unit length, got ${len}`);
  }
});

test('computeElevationBandColor returns expected color for each altitude slice', () => {
  // Low valley (500m) -> Green
  const valleyColor = computeElevationBandColor(500, DEFAULT_ELEVATION_BANDS);
  assert.ok(valleyColor[1] > valleyColor[0] && valleyColor[1] > valleyColor[2]); // Green dominant

  // Subalpine (1500m) -> Light Green
  const subalpineColor = computeElevationBandColor(1500, DEFAULT_ELEVATION_BANDS);
  assert.ok(subalpineColor[1] > subalpineColor[2]);

  // Alpine meadow (2200m) -> Yellow/Gold
  const alpineColor = computeElevationBandColor(2200, DEFAULT_ELEVATION_BANDS);
  assert.ok(alpineColor[0] > 180 && alpineColor[1] > 180); // High red + green = yellow

  // Rocky scree (2800m) -> Orange/Reddish brown
  const screeColor = computeElevationBandColor(2800, DEFAULT_ELEVATION_BANDS);
  assert.ok(screeColor[0] > screeColor[1] && screeColor[0] > screeColor[2]);

  // Summit snow (3500m) -> Pure white
  const summitColor = computeElevationBandColor(3500, DEFAULT_ELEVATION_BANDS);
  assert.ok(summitColor[0] >= 240 && summitColor[1] >= 240 && summitColor[2] >= 240);
});
