export function createWeatherParticles(count, type, volume) {
    const [w, h, d] = volume;
    const particles = [];
    for(let i = 0; i < count; i++){
        const x = (Math.random() - 0.5) * w;
        const y = Math.random() * h;
        const z = (Math.random() - 0.5) * d;
        if (type === 'rain') {
            particles.push({
                x,
                y,
                z,
                vx: (Math.random() - 0.5) * 15,
                vy: -500 - Math.random() * 200,
                vz: (Math.random() - 0.5) * 15,
                size: 3 + Math.random() * 3
            });
        } else {
            particles.push({
                x,
                y,
                z,
                vx: (Math.random() - 0.5) * 20,
                vy: -40 - Math.random() * 60,
                vz: (Math.random() - 0.5) * 20,
                size: 6 + Math.random() * 8
            });
        }
    }
    return particles;
}
export function updateWeather(particles, dt, type, wind, volume, timeSec = 0) {
    const [w, h, d] = volume;
    const halfW = w / 2;
    const halfD = d / 2;
    for(let i = 0; i < particles.length; i++){
        const p = particles[i];
        let turbulenceX = 0;
        let turbulenceZ = 0;
        if (type === 'snow') {
            turbulenceX = Math.sin(timeSec * 2.0 + p.y * 0.05 + i) * 25.0;
            turbulenceZ = Math.cos(timeSec * 1.5 + p.x * 0.05 + i) * 25.0;
        }
        p.x += (p.vx + wind[0] + turbulenceX) * dt;
        p.y += (p.vy + wind[1]) * dt;
        p.z += (p.vz + wind[2] + turbulenceZ) * dt;
        if (p.y < 0) {
            p.y = h;
            p.x = (Math.random() - 0.5) * w;
            p.z = (Math.random() - 0.5) * d;
        }
        if (p.x < -halfW) p.x += w;
        if (p.x > halfW) p.x -= w;
        if (p.z < -halfD) p.z += d;
        if (p.z > halfD) p.z -= d;
    }
}
export function packWeatherBuffer(particles) {
    const stride = 5;
    const buf = new Float32Array(particles.length * stride);
    let offset = 0;
    for (const p of particles){
        buf[offset] = p.x;
        buf[offset + 1] = p.y;
        buf[offset + 2] = p.z;
        buf[offset + 3] = p.size;
        buf[offset + 4] = 0.85;
        offset += stride;
    }
    return buf;
}
export function medianPixel(samples) {
    if (samples.length === 0 || samples.some((sample)=>sample.length < 4)) {
        throw new RangeError('medianPixel requires non-empty RGBA samples');
    }
    const pixel = new Uint8Array(4);
    for(let channel = 0; channel < 4; channel++){
        const values = samples.map((sample)=>sample[channel]).sort((a, b)=>a - b);
        pixel[channel] = values[Math.floor(values.length / 2)];
    }
    return pixel;
}
