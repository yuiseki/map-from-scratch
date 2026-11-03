import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSkyscraperPrisms, projectMercator, type Skyscraper } from './buildings.ts';

test('projectMercator projects coordinate into unit range', () => {
  const [x, y] = projectMercator(-74.0066, 40.7135);
  assert.ok(x > 0.29 && x < 0.30);
  assert.ok(y > 0.37 && y < 0.38);
});

test('generateSkyscraperPrisms produces dark style geometry with glowing accents', () => {
  const skyscrapers: Skyscraper[] = [
    {
      id: 'tower1',
      height: 250,
      base: 0,
      glowColor: [0.2, 0.7, 1.0], // Neon cyan glow
      coordinates: [
        [-74.007, 40.713],
        [-74.006, 40.713],
        [-74.006, 40.714],
        [-74.007, 40.714],
      ],
    },
  ];

  const mesh = generateSkyscraperPrisms(skyscrapers, [-74.0066, 40.7135]);
  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length % 3, 0);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.colors.length, mesh.positions.length);

  // 4 wall quads = 24 verts; 1 roof = 6 verts -> 30 vertices = 90 floats
  assert.equal(mesh.positions.length, 30 * 3);
});
