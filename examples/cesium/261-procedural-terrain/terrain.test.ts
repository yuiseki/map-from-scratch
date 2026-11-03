import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateElevation,
  computeTerrainNormal,
  classifyBiome,
  generateTerrainGrid,
} from './terrain.ts';

test('evaluateElevation produces continuous height within expected amplitude', () => {
  const h0 = evaluateElevation(0, 0, 4, 150);
  const h1 = evaluateElevation(10, 10, 4, 150);
  assert.ok(typeof h0 === 'number' && Number.isFinite(h0));
  assert.ok(typeof h1 === 'number' && Number.isFinite(h1));
  assert.ok(Math.abs(h0) <= 200, 'Height within amplitude scale');
  assert.ok(Math.abs(h1) <= 200, 'Height within amplitude scale');
  assert.ok(Math.abs(h1 - h0) < 50, 'Continuous elevation without sudden jumps');
});

test('computeTerrainNormal computes valid unit normal pointing upwards', () => {
  const normal = computeTerrainNormal(50, 50, 1.0, 150);
  const len = Math.hypot(normal[0], normal[1], normal[2]);
  assert.ok(Math.abs(len - 1.0) < 1e-4, 'Normal is normalized');
  assert.ok(normal[1] > 0, 'Normal points generally upward (Y > 0)');
});

test('classifyBiome distinguishes water, grass, rock and snow', () => {
  const waterLevel = 10;
  const snowLevel = 120;

  // Water below waterLevel
  const bWater = classifyBiome(5, 0.1, waterLevel, snowLevel);
  assert.strictEqual(bWater, 'water');

  // Flat valley above waterLevel
  const bGrass = classifyBiome(40, 0.1, waterLevel, snowLevel);
  assert.strictEqual(bGrass, 'grass');

  // Steep cliff in mid-height
  const bRock = classifyBiome(50, 0.65, waterLevel, snowLevel);
  assert.strictEqual(bRock, 'rock');

  // Summit peak
  const bSnow = classifyBiome(140, 0.2, waterLevel, snowLevel);
  assert.strictEqual(bSnow, 'snow');
});

test('generateTerrainGrid constructs mesh with correct vertex attributes and indices', () => {
  const cols = 10;
  const rows = 10;
  const size = 500;
  const mesh = generateTerrainGrid(cols, rows, size, { maxAltitude: 100 });

  const totalVertices = (cols + 1) * (rows + 1);
  const totalTriangles = cols * rows * 2;

  assert.strictEqual(mesh.positions.length, totalVertices * 3);
  assert.strictEqual(mesh.normals.length, totalVertices * 3);
  assert.strictEqual(mesh.indices.length, totalTriangles * 3);

  for (let i = 0; i < mesh.positions.length; i += 3) {
    const x = mesh.positions[i + 0];
    const z = mesh.positions[i + 2];
    assert.ok(x >= -size / 2 - 1e-4 && x <= size / 2 + 1e-4);
    assert.ok(z >= -size / 2 - 1e-4 && z <= size / 2 + 1e-4);
  }
});
