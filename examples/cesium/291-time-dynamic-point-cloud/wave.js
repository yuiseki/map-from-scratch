export function evaluateHarmonicWave(x, z, t) {
    const w1 = Math.sin(x * 0.08 + t * 1.5) * Math.cos(z * 0.08 + t * 1.2) * 10.0;
    const w2 = Math.sin((x + z) * 0.14 + t * 2.2) * 5.0;
    const w3 = Math.cos((x - z) * 0.22 - t * 3.1) * 2.5;
    return w1 + w2 + w3;
}
export function sampleWaveColor(normalizedElev) {
    const t = Math.max(-1.0, Math.min(1.0, normalizedElev));
    const u = (t + 1.0) * 0.5;
    if (u < 0.25) {
        const k = u / 0.25;
        return [
            0.1 + 0.05 * k,
            0.1 + 0.25 * k,
            0.5 + 0.45 * k
        ];
    } else if (u < 0.5) {
        const k = (u - 0.25) / 0.25;
        return [
            0.15 - 0.05 * k,
            0.35 + 0.55 * k,
            0.95 - 0.15 * k
        ];
    } else if (u < 0.75) {
        const k = (u - 0.5) / 0.25;
        return [
            0.10 + 0.8 * k,
            0.90 + 0.05 * k,
            0.80 - 0.75 * k
        ];
    } else {
        const k = (u - 0.75) / 0.25;
        return [
            0.90 + 0.1 * k,
            0.95 + 0.05 * k,
            0.05 + 0.95 * k
        ];
    }
}
export function generatePointGrid(cols, rows, width, depth) {
    const pointCount = cols * rows;
    const positions = new Float32Array(pointCount * 3);
    const uvs = new Float32Array(pointCount * 2);
    const halfW = width * 0.5;
    const halfD = depth * 0.5;
    const dx = width / Math.max(1, cols - 1);
    const dz = depth / Math.max(1, rows - 1);
    let pIdx = 0;
    let uvIdx = 0;
    for(let r = 0; r < rows; r++){
        const z = -halfD + r * dz;
        const v = r / (rows - 1);
        for(let c = 0; c < cols; c++){
            const x = -halfW + c * dx;
            const u = c / (cols - 1);
            positions[pIdx + 0] = x;
            positions[pIdx + 1] = 0;
            positions[pIdx + 2] = z;
            pIdx += 3;
            uvs[uvIdx + 0] = u;
            uvs[uvIdx + 1] = v;
            uvIdx += 2;
        }
    }
    return {
        positions,
        uvs,
        pointCount
    };
}
