export function projectMercator(lon, lat) {
    const x = (lon + 180) / 360;
    const sin = Math.sin(lat * Math.PI / 180);
    const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
    const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
    return [
        x,
        y
    ];
}
export function arcPoint(p0, p1, t, maxH) {
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const y = p0[1] + (p1[1] - p0[1]) * t;
    const z = 4.0 * maxH * t * (1.0 - t);
    return [
        x,
        y,
        z
    ];
}
export function flowColor(_v, t) {
    const r0 = 0.08, g0 = 0.65, b0 = 0.98;
    const r1 = 0.98, g1 = 0.25, b1 = 0.45;
    const r = r0 + (r1 - r0) * t;
    const g = g0 + (g1 - g0) * t;
    const b = b0 + (b1 - b0) * t;
    const a = 0.85;
    return [
        r,
        g,
        b,
        a
    ];
}
export function decodeArcData(buffer) {
    const view = new DataView(buffer);
    const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
    if (magic !== 'DARC') throw new Error(`Invalid magic: ${magic}`);
    const countyCount = view.getUint16(6, true);
    const flowCount = view.getUint32(8, true);
    const landRingCount = view.getUint16(12, true);
    const nameBytes = view.getUint32(14, true);
    let offset = 32;
    const centroids = new Float32Array(buffer.slice(offset, offset + countyCount * 2 * 4));
    offset += countyCount * 2 * 4;
    const flows = new Array(flowCount);
    for(let i = 0; i < flowCount; i++){
        const s = view.getUint16(offset, true);
        const t = view.getUint16(offset + 2, true);
        const v = view.getInt32(offset + 4, true);
        flows[i] = {
            s,
            t,
            v
        };
        offset += 8;
    }
    const landRings = [];
    for(let r = 0; r < landRingCount; r++){
        const ptCount = view.getUint32(offset, true);
        offset += 4;
        const ring = new Float32Array(buffer.slice(offset, offset + ptCount * 2 * 4));
        landRings.push(ring);
        offset += ptCount * 2 * 4;
    }
    const rawNames = new Uint8Array(buffer, offset, nameBytes);
    const names = new TextDecoder('utf-8').decode(rawNames).split('\0').filter((s)=>s.length > 0);
    return {
        countyCount,
        flowCount,
        centroids,
        flows,
        landRings,
        names
    };
}
