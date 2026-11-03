import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStarBurstParticles,
  updateStarBurst,
  packStarBurstLines,
  type StarParticle,
} from './starburst.ts';

test('createStarBurstParticles creates requested number of 3D stars with non-zero radial velocity', () => {
  const count = 500;
  const radius = 1000;
  const stars = createStarBurstParticles(count, radius);

  assert.strictEqual(stars.length, count);
  for (const s of stars) {
    const dist = Math.hypot(s.x, s.y, s.z);
    assert.ok(dist <= radius * 1.05, 'Star is within initialization volume');
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    assert.ok(speed > 0, 'Star has non-zero radial velocity');
    assert.ok(s.size >= 1 && s.size <= 8, 'Star size in valid range');
  }
});

test('updateStarBurst advances stars radially and respawns when exceeding boundary', () => {
  const stars: StarParticle[] = [
    { x: 0, y: 0, z: -980, vx: 0, vy: 0, vz: -100, size: 2, color: [1, 1, 1] },
  ];
  const maxRadius = 1000;
  const warpFactor = 2.0;

  // dt = 0.5s: vz = -100 * 2.0 = -200 => z becomes -1080 > 1000 => respawns near center
  updateStarBurst(stars, 0.5, warpFactor, maxRadius);
  const newDist = Math.hypot(stars[0].x, stars[0].y, stars[0].z);
  assert.ok(newDist < maxRadius * 0.3, 'Star respawned near center after exceeding maxRadius');
});

test('packStarBurstLines emits streak segment line vertices (head and tail)', () => {
  const stars: StarParticle[] = [
    { x: 10, y: 20, z: 30, vx: 0, vy: 0, vz: -50, size: 2, color: [0.5, 0.8, 1.0] },
  ];

  const stride = 7; // pos(3), color(3), alpha(1)
  // Each streak is 2 vertices (tail and head)
  const buf = packStarBurstLines(stars, 0.1);
  assert.strictEqual(buf.length, stars.length * 2 * stride);

  // Tail vertex
  assert.ok(Math.abs(buf[0] - 10) < 1e-4);
  assert.ok(Math.abs(buf[1] - 20) < 1e-4);
  assert.ok(buf[2] > 30, 'Tail is behind motion direction (higher Z because vz is negative)');
  assert.ok(buf[6] < 0.5, 'Tail has lower alpha');

  // Head vertex
  assert.ok(Math.abs(buf[7] - 10) < 1e-4);
  assert.ok(Math.abs(buf[8] - 20) < 1e-4);
  assert.ok(Math.abs(buf[9] - 30) < 1e-4);
  assert.ok(buf[13] >= 0.8, 'Head has high alpha');
});
