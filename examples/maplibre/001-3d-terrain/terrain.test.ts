import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFujiElevation, generateTerrainMesh } from './terrain.ts';

test('computeFujiElevation gives Mt Fuji peak at rim and caldera crater at center', () => {
  const crater = computeFujiElevation(0, 0);
  assert.ok(crater > 3500 && crater < 3650, `Caldera crater floor should be ~3556m, got ${crater}`);

  const rim = computeFujiElevation(350, 0);
  assert.ok(rim > 3700 && rim < 3800, `Summit rim height should be ~3776m, got ${rim}`);

  const foot = computeFujiElevation(15000, 15000);
  assert.ok(foot < 1000, `Base height should be low, got ${foot}`);
});

test('generateTerrainMesh creates valid grid buffers with normals and colors', () => {
  const mesh = generateTerrainMesh(32, 32, 20000);
  assert.equal(mesh.positions.length, (33 * 33) * 3);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.colors.length, mesh.positions.length);
  assert.equal(mesh.indices.length, 32 * 32 * 6);

  for (let i = 0; i < mesh.positions.length; i++) {
    assert.ok(!Number.isNaN(mesh.positions[i]), `NaN at position ${i}`);
  }
});
