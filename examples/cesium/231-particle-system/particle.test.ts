import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createParticleSystem,
  updateParticleSystem,
  evaluateParticleColor,
  sampleConeVelocity,
} from './particle.ts';

describe('cesium-231-particle-system', () => {
  it('sampleConeVelocity generates directional vectors within cone angle', () => {
    const direction: [number, number, number] = [0, 1, 0]; // upward (+Y)
    const coneAngle = Math.PI / 6; // 30 deg
    const speed = 10;

    for (let i = 0; i < 50; i++) {
      const v = sampleConeVelocity(direction, coneAngle, speed);
      const len = Math.hypot(v[0], v[1], v[2]);
      assert.ok(Math.abs(len - speed) < 1e-4, 'velocity magnitude matches speed');
      // Dot product with direction [0, 1, 0] must be >= cos(coneAngle)
      const dot = (v[0] * direction[0] + v[1] * direction[1] + v[2] * direction[2]) / speed;
      assert.ok(dot >= Math.cos(coneAngle) - 1e-5, `dot product ${dot} within cone angle`);
    }
  });

  it('evaluateParticleColor blends start and end colors over particle lifetime', () => {
    const colStart: [number, number, number, number] = [1.0, 0.8, 0.1, 1.0];
    const colEnd: [number, number, number, number] = [0.8, 0.1, 0.0, 0.0];

    const c0 = evaluateParticleColor(0.0, colStart, colEnd);
    assert.ok(Math.abs(c0[0] - colStart[0]) < 1e-4);
    assert.ok(Math.abs(c0[1] - colStart[1]) < 1e-4);
    assert.ok(Math.abs(c0[2] - colStart[2]) < 1e-4);
    assert.ok(Math.abs(c0[3] - colStart[3]) < 1e-4);

    const c1 = evaluateParticleColor(1.0, colStart, colEnd);
    assert.ok(Math.abs(c1[0] - colEnd[0]) < 1e-4);
    assert.ok(Math.abs(c1[1] - colEnd[1]) < 1e-4);
    assert.ok(Math.abs(c1[2] - colEnd[2]) < 1e-4);
    assert.ok(Math.abs(c1[3] - colEnd[3]) < 1e-4);

    const cMid = evaluateParticleColor(0.5, colStart, colEnd);
    assert.ok(Math.abs(cMid[0] - 0.9) < 1e-4);
    assert.ok(Math.abs(cMid[1] - 0.45) < 1e-4);
    assert.ok(Math.abs(cMid[2] - 0.05) < 1e-4);
    assert.ok(Math.abs(cMid[3] - 0.5) < 1e-4);
  });

  it('updateParticleSystem integrates velocity, buoyancy, and recycles dead particles', () => {
    const sys = createParticleSystem({
      fireCount: 100,
      smokeCount: 100,
      emberCount: 50,
      emitterPos: [0, 0, 0],
    });

    assert.equal(sys.particles.length, 250);

    // A fire particle at rest on the emitter, and one at the end of its life.
    const rising = sys.particles.find((p) => p.kind === 0)!;
    rising.pos = [0, 0, 0]; rising.vel = [0, 1, 0]; rising.age = 0;
    const dying = sys.particles.find((p) => p.kind === 1)!;
    dying.pos = [50, 50, 50]; dying.age = dying.life - 0.01;

    // Initial step
    updateParticleSystem(sys, 0.1, [0, 0, 0]);
    assert.ok(rising.pos[1] > 0, 'velocity is integrated into the position');
    assert.ok(dying.age < 0.1 && Math.hypot(...dying.pos) < 5, 'a dead particle restarts at the emitter');

    // Check buffer layout: 8 floats per particle (x, y, z, size, r, g, b, a)
    const buf = sys.buffer;
    assert.equal(buf.length, 250 * 8);

    // All active particles should have moved from y=0
    let movedCount = 0;
    for (let i = 0; i < sys.particles.length; i++) {
      if (sys.particles[i].pos[1] > 0) movedCount++;
    }
    assert.ok(movedCount > 200, 'majority of particles have risen upward along +Y');

    // Fast-forward many seconds to ensure recycling runs without crash
    for (let step = 0; step < 100; step++) {
      updateParticleSystem(sys, 0.1, [1, 0, 0]);
    }
    assert.equal(sys.particles.length, 250);
  });
});
