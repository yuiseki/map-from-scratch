export function sampleConeVelocity(dir, angle, speed) {
    const dLen = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const nx = dir[0] / dLen;
    const ny = dir[1] / dLen;
    const nz = dir[2] / dLen;
    let ax = 1, ay = 0, az = 0;
    if (Math.abs(nx) > 0.9) {
        ax = 0;
        ay = 1;
        az = 0;
    }
    let ux = ay * nz - az * ny;
    let uy = az * nx - ax * nz;
    let uz = ax * ny - ay * nx;
    const uLen = Math.hypot(ux, uy, uz);
    ux /= uLen;
    uy /= uLen;
    uz /= uLen;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;
    const cosTheta = 1 - Math.random() * (1 - Math.cos(angle));
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const phi = Math.random() * Math.PI * 2;
    const lx = Math.cos(phi) * sinTheta;
    const ly = Math.sin(phi) * sinTheta;
    const lz = cosTheta;
    const outX = ux * lx + vx * ly + nx * lz;
    const outY = uy * lx + vy * ly + ny * lz;
    const outZ = uz * lx + vz * ly + nz * lz;
    return [
        outX * speed,
        outY * speed,
        outZ * speed
    ];
}
export function evaluateParticleColor(t, c0, c1) {
    const clamped = Math.max(0, Math.min(1, t));
    return [
        c0[0] + (c1[0] - c0[0]) * clamped,
        c0[1] + (c1[1] - c0[1]) * clamped,
        c0[2] + (c1[2] - c0[2]) * clamped,
        c0[3] + (c1[3] - c0[3]) * clamped
    ];
}
function resetParticle(p, emitterPos, kind) {
    p.kind = kind;
    const rDisp = kind === 0 ? 0.3 : kind === 1 ? 0.8 : 0.2;
    const theta = Math.random() * Math.PI * 2;
    const rad = Math.random() * rDisp;
    p.pos = [
        emitterPos[0] + Math.cos(theta) * rad,
        emitterPos[1] + Math.random() * 0.2,
        emitterPos[2] + Math.sin(theta) * rad
    ];
    if (kind === 0) {
        const speed = 6.0 + Math.random() * 5.0;
        p.vel = sampleConeVelocity([
            0,
            1,
            0
        ], Math.PI * 0.15, speed);
        p.life = 0.5 + Math.random() * 0.7;
        p.age = Math.random() * p.life;
        p.sizeStart = 16.0 + Math.random() * 8.0;
        p.sizeEnd = 36.0 + Math.random() * 12.0;
        p.colStart = [
            1.0,
            0.95,
            0.7,
            1.0
        ];
        p.colEnd = [
            1.0,
            0.2,
            0.02,
            0.0
        ];
    } else if (kind === 1) {
        const speed = 2.0 + Math.random() * 3.0;
        p.vel = sampleConeVelocity([
            0,
            1,
            0
        ], Math.PI * 0.25, speed);
        p.life = 2.0 + Math.random() * 1.8;
        p.age = Math.random() * p.life;
        p.sizeStart = 20.0 + Math.random() * 10.0;
        p.sizeEnd = 90.0 + Math.random() * 40.0;
        p.colStart = [
            0.35,
            0.32,
            0.30,
            0.6
        ];
        p.colEnd = [
            0.15,
            0.15,
            0.15,
            0.0
        ];
    } else {
        const speed = 8.0 + Math.random() * 7.0;
        p.vel = sampleConeVelocity([
            0,
            1,
            0
        ], Math.PI * 0.35, speed);
        p.life = 1.2 + Math.random() * 1.5;
        p.age = Math.random() * p.life;
        p.sizeStart = 6.0 + Math.random() * 4.0;
        p.sizeEnd = 1.5;
        p.colStart = [
            1.0,
            0.75,
            0.2,
            1.0
        ];
        p.colEnd = [
            0.8,
            0.15,
            0.0,
            0.0
        ];
    }
}
export function createParticleSystem(config) {
    const total = config.fireCount + config.smokeCount + config.emberCount;
    const particles = [];
    for(let i = 0; i < config.fireCount; i++){
        const p = {};
        resetParticle(p, config.emitterPos, 0);
        particles.push(p);
    }
    for(let i = 0; i < config.smokeCount; i++){
        const p = {};
        resetParticle(p, config.emitterPos, 1);
        particles.push(p);
    }
    for(let i = 0; i < config.emberCount; i++){
        const p = {};
        resetParticle(p, config.emitterPos, 2);
        particles.push(p);
    }
    const buffer = new Float32Array(total * 8);
    return {
        particles,
        buffer,
        emitterPos: [
            ...config.emitterPos
        ],
        time: 0,
        fireCount: config.fireCount,
        smokeCount: config.smokeCount,
        emberCount: config.emberCount
    };
}
export function updateParticleSystem(sys, dt, wind) {
    sys.time += dt;
    const particles = sys.particles;
    const buf = sys.buffer;
    for(let i = 0; i < particles.length; i++){
        const p = particles[i];
        p.age += dt;
        if (p.age >= p.life) {
            resetParticle(p, sys.emitterPos, p.kind);
            p.age = 0;
        }
        const t = p.age / p.life;
        if (p.kind === 0) {
            p.vel[1] += 4.0 * dt;
            p.vel[0] *= Math.max(0, 1 - 0.5 * dt);
            p.vel[1] *= Math.max(0, 1 - 0.2 * dt);
            p.vel[2] *= Math.max(0, 1 - 0.5 * dt);
        } else if (p.kind === 1) {
            p.vel[0] += (wind[0] * 3.0 - p.vel[0]) * 0.4 * dt;
            p.vel[1] += (4.0 - p.vel[1]) * 0.3 * dt;
            p.vel[2] += (wind[2] * 3.0 - p.vel[2]) * 0.4 * dt;
            const turb = Math.sin(sys.time * 3 + p.pos[1] * 0.8) * 0.5;
            p.vel[0] += turb * dt;
        } else {
            p.vel[1] -= 2.0 * dt;
            p.vel[0] += wind[0] * 1.5 * dt;
            p.vel[2] += wind[2] * 1.5 * dt;
        }
        p.pos[0] += p.vel[0] * dt;
        p.pos[1] += p.vel[1] * dt;
        p.pos[2] += p.vel[2] * dt;
        const size = p.sizeStart + (p.sizeEnd - p.sizeStart) * t;
        const col = evaluateParticleColor(t, p.colStart, p.colEnd);
        const offset = i * 8;
        buf[offset + 0] = p.pos[0];
        buf[offset + 1] = p.pos[1];
        buf[offset + 2] = p.pos[2];
        buf[offset + 3] = size;
        buf[offset + 4] = col[0];
        buf[offset + 5] = col[1];
        buf[offset + 6] = col[2];
        buf[offset + 7] = col[3];
    }
}
