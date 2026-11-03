import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FireworkSimulation,
  packParticleBuffer,
  createBurst,
  type Particle,
} from './fireworks.ts';

test('createBurst generates spherical velocity distribution with requested color', () => {
  const origin: [number, number, number] = [0, 500, 0];
  const color: [number, number, number] = [1.0, 0.4, 0.2];
  const count = 100;
  const particles = createBurst(origin, color, count, 200);

  assert.equal(particles.length, count);
  for (const p of particles) {
    assert.deepEqual(p.position, origin);
    assert.equal(p.color[0], color[0]);
    assert.equal(p.color[1], color[1]);
    assert.equal(p.color[2], color[2]);
    assert.ok(p.maxLife > 0);
    assert.equal(p.life, p.maxLife);
    const speed = Math.hypot(p.velocity[0], p.velocity[1], p.velocity[2]);
    assert.ok(speed > 50 && speed <= 250);
  }
});

test('FireworkSimulation updates physics, applies gravity and cleans dead particles', () => {
  const sim = new FireworkSimulation(false);
  // Manually trigger burst
  sim.burst([0, 400, 0], [0.2, 0.8, 1.0], 50);
  assert.equal(sim.getParticleCount(), 50);

  // Advance by 0.1s
  sim.update(0.1);
  assert.equal(sim.getParticleCount(), 50);

  // Position should have changed
  const p0 = sim.particles[0];
  assert.notEqual(p0.position[1], 400);

  // Gravity pulls a particle at rest downward, then drag slows it.
  p0.velocity = [0, 0, 0];
  sim.update(0.1);
  assert.ok(Math.abs(p0.velocity[1] - -90 * 0.1 * (1 - 0.55 * 0.1)) < 1e-9);

  // Advance past lifetime (e.g. 5 seconds)
  sim.update(5.0);
  // Dead particles should be removed
  assert.equal(sim.getParticleCount(), 0);
});

test('packParticleBuffer formats positions, colors, and sizes for GPU VBO', () => {
  const particles: Particle[] = [
    {
      position: [10, 20, 30],
      velocity: [0, 10, 0],
      color: [1, 0, 0],
      life: 1.0,
      maxLife: 2.0,
      size: 16,
    },
    {
      position: [-5, 15, 25],
      velocity: [1, 0, -1],
      color: [0, 1, 0],
      life: 0.5,
      maxLife: 1.0,
      size: 8,
    },
  ];

  // Each particle: x, y, z, r, g, b, alpha, size = 8 floats
  const buffer = packParticleBuffer(particles);
  assert.equal(buffer.length, particles.length * 8);

  // First particle
  assert.equal(buffer[0], 10);
  assert.equal(buffer[1], 20);
  assert.equal(buffer[2], 30);
  assert.equal(buffer[3], 1); // R
  assert.equal(buffer[4], 0); // G
  assert.equal(buffer[5], 0); // B
  assert.ok(Math.abs(buffer[6] - 0.5) < 1e-4); // Alpha = life / maxLife = 1.0 / 2.0
  assert.equal(buffer[7], 16); // Size
});
