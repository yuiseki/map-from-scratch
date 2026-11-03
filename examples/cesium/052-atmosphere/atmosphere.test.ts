import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  raySphereIntersect,
  rayleighPhase,
  miePhase,
  computeSunDirection,
  generateSphereMesh,
} from './atmosphere.ts';

test('raySphereIntersect finds entry and exit points for ray hitting sphere', () => {
  const origin: [number, number, number] = [0, 0, 3];
  const dir: [number, number, number] = [0, 0, -1];
  const radius = 1.0;

  const hits = raySphereIntersect(origin, dir, radius);
  assert.ok(hits !== null);
  const [t0, t1] = hits;
  assert.ok(Math.abs(t0 - 2.0) < 1e-4);
  assert.ok(Math.abs(t1 - 4.0) < 1e-4);
});

test('raySphereIntersect returns null when ray misses sphere', () => {
  const origin: [number, number, number] = [0, 2, 3];
  const dir: [number, number, number] = [0, 0, -1];
  const radius = 1.0;

  const hits = raySphereIntersect(origin, dir, radius);
  assert.strictEqual(hits, null);
});

test('rayleighPhase and miePhase compute valid optical phase weights', () => {
  const cos0 = 1.0; // Forward scattering
  const cos90 = 0.0;
  const cos180 = -1.0; // Back scattering

  const r0 = rayleighPhase(cos0);
  const r90 = rayleighPhase(cos90);
  assert.ok(r0 > r90, 'Rayleigh forward is greater than 90 deg scattering');

  const m0 = miePhase(cos0, 0.76);
  const m180 = miePhase(cos180, 0.76);
  assert.ok(m0 > m180 * 5, 'Mie forward scattering is much stronger than back scattering');
});

test('computeSunDirection returns normalized 3D sun vector', () => {
  const sun0 = computeSunDirection(0);
  const len = Math.hypot(sun0[0], sun0[1], sun0[2]);
  assert.ok(Math.abs(len - 1.0) < 1e-5);
  assert.ok(Math.abs(sun0[1]) < 0.5);
});

test('generateSphereMesh builds vertices and indices with correct bounds', () => {
  const { positions, normals, uvs, indices } = generateSphereMesh(16, 16, 1.0);
  assert.ok(positions.length > 0);
  assert.ok(positions.length === normals.length);
  assert.ok(positions.length / 3 === uvs.length / 2);
  assert.ok(indices.length > 0);

  // Radius check
  for (let i = 0; i < positions.length; i += 3) {
    const r = Math.hypot(positions[i], positions[i + 1], positions[i + 2]);
    assert.ok(Math.abs(r - 1.0) < 1e-4);
  }
});
