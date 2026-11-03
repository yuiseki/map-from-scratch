import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeOrbitPosition,
  EmitterTrail,
  packTailParticles,
} from './tails.ts';

test('computeOrbitPosition returns valid 3D position on elliptical orbit', () => {
  const semiMajor = 400;
  const semiMinor = 300;
  const inclination = Math.PI / 6;

  const pos0 = computeOrbitPosition(0, semiMajor, semiMinor, inclination);
  const posQuarter = computeOrbitPosition(Math.PI / 2, semiMajor, semiMinor, inclination);

  assert.ok(Math.abs(pos0[0] - semiMajor) < 1e-4);
  assert.ok(Math.abs(posQuarter[0]) < 1e-4);
  assert.ok(posQuarter[1] !== 0 && posQuarter[2] !== 0, 'Inclination tilts Y/Z coordinates at quarter orbit');
});

test('EmitterTrail spawns particles and updates their lifetime and dispersion', () => {
  const trail = new EmitterTrail([1.0, 0.7, 0.2], 500);
  assert.strictEqual(trail.getParticles().length, 0);

  // Emit 20 particles from position [100, 50, 0] with velocity [-10, 0, 0]
  trail.emit([100, 50, 0], [-10, 0, 0], 20);
  assert.strictEqual(trail.getParticles().length, 20);

  // Update dt = 0.1s
  trail.update(0.1);
  const p = trail.getParticles()[0];
  assert.ok(p.age > 0, 'Particle age increases');
  assert.ok(p.size > 2, 'Particle expands over time');
});

test('packTailParticles converts particles into packed Float32Array with position, size, and RGBA', () => {
  const trail = new EmitterTrail([0.2, 0.8, 1.0], 100);
  trail.emit([10, 20, 30], [0, 5, 0], 5);

  const stride = 8; // x, y, z, size, r, g, b, alpha
  const buf = packTailParticles(trail.getParticles());
  assert.strictEqual(buf.length, 5 * stride);
  assert.ok(Math.abs(buf[0] - 10) <= 2.0);
  assert.ok(Math.abs(buf[1] - 20) <= 2.0);
  assert.ok(Math.abs(buf[2] - 30) <= 2.0);
  assert.ok(buf[7] > 0.5, 'Fresh particle has high alpha');
});
