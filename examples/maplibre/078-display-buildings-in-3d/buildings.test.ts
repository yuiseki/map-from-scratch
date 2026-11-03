import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBuildingPrisms, projectMercator, type BuildingFootprint } from './buildings.ts';

test('projectMercator converts lon/lat to normalized coordinates', () => {
  const [x, y] = projectMercator(-74.006, 40.7128);
  assert.ok(x > 0.29 && x < 0.30, `x=${x} out of range`);
  assert.ok(y > 0.37 && y < 0.38, `y=${y} out of range`);
});

test('generateBuildingPrisms produces valid vertex and normal arrays', () => {
  const buildings: BuildingFootprint[] = [
    {
      id: 'b1',
      height: 120,
      base: 0,
      coordinates: [
        [-74.01, 40.71],
        [-74.009, 40.71],
        [-74.009, 40.711],
        [-74.01, 40.711],
      ],
    },
  ];

  const mesh = generateBuildingPrisms(buildings, [-74.01, 40.71], 1000);
  assert.ok(mesh.positions.length > 0, 'positions should not be empty');
  assert.equal(mesh.positions.length % 3, 0, 'positions must be triplets');
  assert.equal(mesh.normals.length, mesh.positions.length, 'normals count must match positions count');
  assert.equal(mesh.colors.length, mesh.positions.length, 'colors count must match positions count');

  // Side walls for a 4-vertex ring: 4 walls * 2 triangles * 3 vertices = 24 vertices
  // Roof for a 4-vertex quad: 2 triangles * 3 vertices = 6 vertices
  // Total vertices = 30 -> 90 floats
  assert.equal(mesh.positions.length, 30 * 3, 'expected 30 vertices (90 floats)');
});
