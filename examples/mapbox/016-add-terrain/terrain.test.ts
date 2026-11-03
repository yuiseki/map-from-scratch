import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCanyonElevation, generateCanyonTerrainMesh } from './terrain.ts';

test('computeCanyonElevation produces deep valley floor and soaring granite cliffs', () => {
  const valleyCenter = computeCanyonElevation(0, 0);
  assert.ok(valleyCenter > 1100 && valleyCenter < 1300, `Valley floor should be ~1200m, got ${valleyCenter}`);

  // Cliff monolith at (2000, 1500)
  const cliffTop = computeCanyonElevation(2200, 1500);
  assert.ok(cliffTop > 2000 && cliffTop < 2700, `Granite monolith top should be >2000m, got ${cliffTop}`);
});

test('generateCanyonTerrainMesh builds valid vertex, normal, color and index buffers', () => {
  const mesh = generateCanyonTerrainMesh(32, 32, 8000);
  assert.equal(mesh.positions.length, (33 * 33) * 3);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.colors.length, mesh.positions.length);
  assert.equal(mesh.indices.length, 32 * 32 * 6);

  for (let i = 0; i < mesh.positions.length; i++) {
    assert.ok(!Number.isNaN(mesh.positions[i]), `NaN at position ${i}`);
  }
});
