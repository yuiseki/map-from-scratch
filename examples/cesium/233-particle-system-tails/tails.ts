/**
 * 3D Orbiting Particle System Tails for CesiumJS Particle System Tails reproduction.
 * Zero external runtime dependencies.
 */

export function computeOrbitPosition(
  theta: number,
  semiMajor: number,
  semiMinor: number,
  inclination: number,
): [number, number, number] {
  // Ellipse in orbital plane
  const xOrb = semiMajor * Math.cos(theta);
  const zOrb = semiMinor * Math.sin(theta);

  // Rotate by orbital inclination around X axis
  const cosInc = Math.cos(inclination);
  const sinInc = Math.sin(inclination);

  const x = xOrb;
  const y = -zOrb * sinInc;
  const z = zOrb * cosInc;

  return [x, y, z];
}

export interface TailParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  maxSize: number;
  age: number;
  lifetime: number;
  color: [number, number, number];
}

export class EmitterTrail {
  private particles: TailParticle[] = [];
  public color: [number, number, number];
  public maxParticles: number;

  constructor(color: [number, number, number], maxParticles = 1200) {
    this.color = color;
    this.maxParticles = maxParticles;
  }

  public emit(pos: [number, number, number], emitterVelocity: [number, number, number], count: number): void {
    const toAdd = Math.min(count, this.maxParticles - this.particles.length);
    for (let i = 0; i < toAdd; i++) {
      // Particles eject backwards relative to motion with slight radial puff dispersion
      const spread = 8.0;
      const vx = -emitterVelocity[0] * 0.15 + (Math.random() - 0.5) * spread;
      const vy = -emitterVelocity[1] * 0.15 + (Math.random() - 0.5) * spread;
      const vz = -emitterVelocity[2] * 0.15 + (Math.random() - 0.5) * spread;

      this.particles.push({
        x: pos[0] + (Math.random() - 0.5) * 2.0,
        y: pos[1] + (Math.random() - 0.5) * 2.0,
        z: pos[2] + (Math.random() - 0.5) * 2.0,
        vx,
        vy,
        vz,
        size: 3.0 + Math.random() * 2.0,
        maxSize: 18.0 + Math.random() * 10.0,
        age: 0,
        lifetime: 1.2 + Math.random() * 0.8,
        color: this.color,
      });
    }
  }

  public update(dt: number): void {
    let alive = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.age += dt;
      if (p.age < p.lifetime) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        // Expand puff over time
        const lifeRatio = p.age / p.lifetime;
        p.size = 3.0 + (p.maxSize - 3.0) * Math.pow(lifeRatio, 0.7);

        this.particles[alive++] = p;
      }
    }
    this.particles.length = alive;
  }

  public getParticles(): TailParticle[] {
    return this.particles;
  }
}

export function packTailParticles(particles: TailParticle[]): Float32Array {
  // Stride: x, y, z, size, r, g, b, alpha (8 floats)
  const stride = 8;
  const buf = new Float32Array(particles.length * stride);
  let offset = 0;

  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    const lifeRatio = Math.min(1.0, p.age / p.lifetime);
    // Smooth fade out
    const alpha = (1.0 - lifeRatio * lifeRatio) * 0.85;

    buf[offset++] = p.x;
    buf[offset++] = p.y;
    buf[offset++] = p.z;
    buf[offset++] = p.size;
    buf[offset++] = p.color[0];
    buf[offset++] = p.color[1];
    buf[offset++] = p.color[2];
    buf[offset++] = alpha;
  }

  return buf;
}
