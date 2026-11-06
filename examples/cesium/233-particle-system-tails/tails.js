export function computeOrbitPosition(theta, semiMajor, semiMinor, inclination) {
    const xOrb = semiMajor * Math.cos(theta);
    const zOrb = semiMinor * Math.sin(theta);
    const cosInc = Math.cos(inclination);
    const sinInc = Math.sin(inclination);
    const x = xOrb;
    const y = -zOrb * sinInc;
    const z = zOrb * cosInc;
    return [
        x,
        y,
        z
    ];
}
export class EmitterTrail {
    particles = [];
    color;
    maxParticles;
    constructor(color, maxParticles = 1200){
        this.color = color;
        this.maxParticles = maxParticles;
    }
    emit(pos, emitterVelocity, count) {
        const toAdd = Math.min(count, this.maxParticles - this.particles.length);
        for(let i = 0; i < toAdd; i++){
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
                color: this.color
            });
        }
    }
    update(dt) {
        let alive = 0;
        for(let i = 0; i < this.particles.length; i++){
            const p = this.particles[i];
            p.age += dt;
            if (p.age < p.lifetime) {
                p.x += p.vx * dt;
                p.y += p.vy * dt;
                p.z += p.vz * dt;
                const lifeRatio = p.age / p.lifetime;
                p.size = 3.0 + (p.maxSize - 3.0) * Math.pow(lifeRatio, 0.7);
                this.particles[alive++] = p;
            }
        }
        this.particles.length = alive;
    }
    getParticles() {
        return this.particles;
    }
}
export function packTailParticles(particles) {
    const stride = 8;
    const buf = new Float32Array(particles.length * stride);
    let offset = 0;
    for(let i = 0; i < particles.length; i++){
        const p = particles[i];
        const lifeRatio = Math.min(1.0, p.age / p.lifetime);
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
