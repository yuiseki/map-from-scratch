export function decodeHM01(buffer) {
    if (buffer.byteLength < 32) throw new Error('heatmap buffer too short');
    const view = new DataView(buffer);
    if (view.getUint32(0, true) !== 0x31304d48) throw new Error('invalid heatmap header');
    const count = view.getUint32(4, true);
    const west = view.getFloat32(8, true);
    const north = view.getFloat32(12, true);
    const east = view.getFloat32(16, true);
    const south = view.getFloat32(20, true);
    const totalWeight = view.getUint32(24, true);
    const expectedLength = 32 + count * 6;
    if (buffer.byteLength !== expectedLength) {
        throw new Error(`truncated heatmap data: expected ${expectedLength}, got ${buffer.byteLength}`);
    }
    const spanX = east - west;
    const spanY = south - north;
    const points = [];
    for(let i = 0; i < count; i++){
        const offset = 32 + i * 6;
        const qx = view.getUint16(offset, true);
        const qy = view.getUint16(offset + 2, true);
        const weight = view.getUint16(offset + 4, true);
        const x = west + qx / 65535 * spanX;
        const y = north + qy / 65535 * spanY;
        points.push({
            x,
            y,
            weight
        });
    }
    return {
        count,
        bounds: [
            west,
            north,
            east,
            south
        ],
        totalWeight,
        points
    };
}
export function mercatorProject(lon, lat) {
    const x = (lon + 180) / 360;
    const rad = lat * Math.PI / 180;
    const y = (1 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / Math.PI) / 2;
    return {
        x,
        y
    };
}
export function gaussianWeight(distance, radius) {
    if (distance > radius) return 0.0;
    const r2 = distance * distance / (radius * radius);
    return Math.exp(-4.0 * r2);
}
export function sampleColorRamp(t) {
    const clamped = Math.max(0, Math.min(1, t));
    if (clamped < 0.25) {
        const f = clamped * 4.0;
        return {
            r: 0.13 + (0.18 - 0.13) * f,
            g: 0.20 + (0.48 - 0.20) * f,
            b: 0.40 + (0.72 - 0.40) * f
        };
    } else if (clamped < 0.50) {
        const f = (clamped - 0.25) * 4.0;
        return {
            r: 0.18 + (0.30 - 0.18) * f,
            g: 0.48 + (0.78 - 0.48) * f,
            b: 0.72 + (0.70 - 0.72) * f
        };
    } else if (clamped < 0.75) {
        const f = (clamped - 0.50) * 4.0;
        return {
            r: 0.30 + (1.00 - 0.30) * f,
            g: 0.78 + (0.84 - 0.78) * f,
            b: 0.70 + (0.34 - 0.70) * f
        };
    } else {
        const f = (clamped - 0.75) * 4.0;
        return {
            r: 1.00 + (0.98 - 1.00) * f,
            g: 0.84 + (0.29 - 0.84) * f,
            b: 0.34 + (0.24 - 0.34) * f
        };
    }
}
