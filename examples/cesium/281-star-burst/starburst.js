export function createStarBurstParticles(count, maxRadius = 1000) {
    const stars = [];
    for(let i = 0; i < count; i++){
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const dirX = Math.sin(phi) * Math.cos(theta);
        const dirY = Math.sin(phi) * Math.sin(theta);
        const dirZ = Math.cos(phi);
        const r = Math.pow(Math.random(), 0.5) * maxRadius;
        const baseSpeed = 120 + Math.random() * 200;
        const temp = Math.random();
        let color;
        if (temp < 0.3) {
            color = [
                1.0,
                0.75,
                0.5
            ];
        } else if (temp < 0.7) {
            color = [
                1.0,
                1.0,
                1.0
            ];
        } else {
            color = [
                0.45,
                0.8,
                1.0
            ];
        }
        stars.push({
            x: dirX * r,
            y: dirY * r,
            z: dirZ * r,
            vx: dirX * baseSpeed,
            vy: dirY * baseSpeed,
            vz: dirZ * baseSpeed,
            size: 1.5 + Math.random() * 3.5,
            color
        });
    }
    return stars;
}
export function updateStarBurst(stars, dt, warpFactor = 1.0, maxRadius = 1000) {
    for(let i = 0; i < stars.length; i++){
        const s = stars[i];
        s.x += s.vx * warpFactor * dt;
        s.y += s.vy * warpFactor * dt;
        s.z += s.vz * warpFactor * dt;
        const dist = Math.hypot(s.x, s.y, s.z);
        if (dist > maxRadius) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const dirX = Math.sin(phi) * Math.cos(theta);
            const dirY = Math.sin(phi) * Math.sin(theta);
            const dirZ = Math.cos(phi);
            const r = Math.random() * (maxRadius * 0.15) + 5;
            const baseSpeed = 120 + Math.random() * 200;
            s.x = dirX * r;
            s.y = dirY * r;
            s.z = dirZ * r;
            s.vx = dirX * baseSpeed;
            s.vy = dirY * baseSpeed;
            s.vz = dirZ * baseSpeed;
        }
    }
}
export function packStarBurstLines(stars, streakTime = 0.08) {
    const stride = 7;
    const buf = new Float32Array(stars.length * 2 * stride);
    let offset = 0;
    for(let i = 0; i < stars.length; i++){
        const s = stars[i];
        const tailX = s.x - s.vx * streakTime;
        const tailY = s.y - s.vy * streakTime;
        const tailZ = s.z - s.vz * streakTime;
        buf[offset++] = tailX;
        buf[offset++] = tailY;
        buf[offset++] = tailZ;
        buf[offset++] = s.color[0];
        buf[offset++] = s.color[1];
        buf[offset++] = s.color[2];
        buf[offset++] = 0.05;
        buf[offset++] = s.x;
        buf[offset++] = s.y;
        buf[offset++] = s.z;
        buf[offset++] = s.color[0];
        buf[offset++] = s.color[1];
        buf[offset++] = s.color[2];
        buf[offset++] = 0.95;
    }
    return buf;
}
