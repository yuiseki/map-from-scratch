import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTerrarium, createTerrainMesh, hypsometricColor } from './terrain.ts';

test('Terrarium RGB decodes signed elevations and fractional metres', () => {
  const rgba = new Uint8Array([
    128, 0, 0, 255,  // 0 m
    128, 0, 128, 255, // 0.5 m
    127, 255, 0, 255, // -1 m
  ]);
  assert.deepEqual([...decodeTerrarium(rgba, 3, 1)], [0, 0.5, -1]);
});

test('Terrarium decoder rejects a payload whose dimensions do not match', () => {
  assert.throws(() => decodeTerrarium(new Uint8Array(8), 2, 2), RangeError);
});

test('terrain mesh builds a centered indexed grid and preserves relief scale', () => {
  const mesh = createTerrainMesh(new Float32Array([10, 20, 30, 40]), 2, 2, 2, 2, 0.1);
  assert.equal(mesh.positions.length, 4 * 3);
  assert.equal(mesh.colors.length, 4 * 3);
  assert.equal(mesh.indices.length, 6);
  assert.deepEqual([...mesh.positions.slice(0, 3)], [-1, -1, 0]);
  assert.equal(mesh.positions[11], 3);
});

test('hypsometric colors distinguish water, forest, rock and snow', () => {
  const sea = hypsometricColor(-10);
  const forest = hypsometricColor(800);
  const rock = hypsometricColor(2600);
  const snow = hypsometricColor(4200);
  assert.ok(sea[2] > sea[1] && sea[1] > sea[0]);
  assert.ok(forest[1] > forest[0]);
  assert.ok(rock[0] > 0.2 && rock[0] < 0.75);
  assert.deepEqual(snow, [0.92, 0.95, 1]);
});

test('orbit input clamps pitch and zoom distance', async () => {
  const { orbitCamera, zoomTerrain } = await import('./terrain.ts');
  assert.deepEqual(orbitCamera(0.2, 0.4, 10, 20), [0.35, 0.5]);
  assert.deepEqual(orbitCamera(0, 1.1, 0, 100), [0, 1.2]);
  assert.equal(zoomTerrain(4, -1000), 2.4);
  assert.equal(zoomTerrain(4, 1000), 8);
});
