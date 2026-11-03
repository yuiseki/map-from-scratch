/**
 * 3D Particle system and fireworks physics simulation for CesiumJS Fireworks reproduction.
 * Zero external runtime dependencies.
 */

export interface Particle {
  position: [number, number, number];
  velocity: [number, number, number];
  color: [number, number, number];
  life: number;
  maxLife: number;
  size: number;
}

export interface Rocket {
  position: [number, number, number];
  velocity: [number, number, number];
  color: [number, number, number];
  targetY: number;
}

const PALETTE: [number, number, number][] = [
  [1.0, 0.25, 0.2],  // Crimson red
  [1.0, 0.85, 0.1],  // Golden amber
  [0.2, 0.95, 0.4],  // Emerald green
  [0.2, 0.7, 1.0],   // Cyan azure
  [0.95, 0.3, 0.9],  // Magenta violet
  [1.0, 1.0, 1.0],   // Silver spark
];

export function createBurst(
  origin: [number, number, number],
  color: [number, number, number],
  count = 120,
  baseSpeed = 160,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    // Uniform sphere distribution (Fibonacci or spherical coordinates)
    const u = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const sinT = Math.sqrt(Math.max(0, 1 - u * u));

    const speed = baseSpeed * (0.5 + Math.random() * 0.5);
    const vx = sinT * Math.cos(phi) * speed;
    const vy = u * speed;
    const vz = sinT * Math.sin(phi) * speed;

    const maxLife = 1.4 + Math.random() * 1.0;
    particles.push({
      position: [origin[0], origin[1], origin[2]],
      velocity: [vx, vy, vz],
      color,
      life: maxLife,
      maxLife,
      size: 14 + Math.random() * 10,
    });
  }
  return particles;
}

export class FireworkSimulation {
  public particles: Particle[] = [];
  public rockets: Rocket[] = [];
  private launchTimer = 0;

  constructor(autoSeed = true) {
    if (autoSeed) {
      // Seed initial bursts
      this.burst([0, 450, 0], [1.0, 0.8, 0.2], 120, 180);
      this.burst([-200, 380, -100], [0.2, 0.8, 1.0], 100, 150);
      this.burst([220, 520, -50], [1.0, 0.25, 0.4], 130, 200);
    }
  }

  public burst(
    origin: [number, number, number],
    color: [number, number, number],
    count = 120,
    baseSpeed = 160,
  ): void {
    const burstParticles = createBurst(origin, color, count, baseSpeed);
    for (const p of burstParticles) {
      this.particles.push(p);
    }
  }

  public launchRocket(x: number, z: number, color?: [number, number, number]): void {
    const chosenColor = color ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const targetY = 350 + Math.random() * 250;
    const vy = 350 + Math.random() * 100;
    this.rockets.push({
      position: [x, 0, z],
      velocity: [(Math.random() - 0.5) * 40, vy, (Math.random() - 0.5) * 40],
      color: chosenColor,
      targetY,
    });
  }

  public getParticleCount(): number {
    return this.particles.length + this.rockets.length;
  }

  public update(dt: number): void {
    this.launchTimer += dt;
    if (this.launchTimer >= 0.75) {
      this.launchTimer = 0;
      const x = (Math.random() - 0.5) * 500;
      const z = (Math.random() - 0.5) * 300;
      this.launchRocket(x, z);
    }

    // Update rockets
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.position[0] += r.velocity[0] * dt;
      r.position[1] += r.velocity[1] * dt;
      r.position[2] += r.velocity[2] * dt;

      // Emit small rocket spark trail
      if (Math.random() < 0.8) {
        this.particles.push({
          position: [r.position[0], r.position[1], r.position[2]],
          velocity: [(Math.random() - 0.5) * 10, -20 - Math.random() * 20, (Math.random() - 0.5) * 10],
          color: [1.0, 0.9, 0.6],
          life: 0.25,
          maxLife: 0.25,
          size: 6,
        });
      }

      if (r.position[1] >= r.targetY) {
        // Rocket explodes
        this.burst(r.position, r.color, 140, 180);
        this.rockets.splice(i, 1);
      }
    }

    // Update particles
    const gravity = 90.0;
    const drag = 0.55;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      p.position[0] += p.velocity[0] * dt;
      p.position[1] += p.velocity[1] * dt;
      p.position[2] += p.velocity[2] * dt;

      p.velocity[1] -= gravity * dt;
      p.velocity[0] *= Math.max(0, 1 - drag * dt);
      p.velocity[1] *= Math.max(0, 1 - drag * dt);
      p.velocity[2] *= Math.max(0, 1 - drag * dt);
    }
  }
}

export function packParticleBuffer(particles: Particle[]): Float32Array {
  const stride = 8;
  const buffer = new Float32Array(particles.length * stride);
  let offset = 0;

  for (const p of particles) {
    const alpha = Math.max(0, Math.min(1, p.life / p.maxLife));
    buffer[offset] = p.position[0];
    buffer[offset + 1] = p.position[1];
    buffer[offset + 2] = p.position[2];
    buffer[offset + 3] = p.color[0];
    buffer[offset + 4] = p.color[1];
    buffer[offset + 5] = p.color[2];
    buffer[offset + 6] = alpha;
    buffer[offset + 7] = p.size;
    offset += stride;
  }

  return buffer;
}
