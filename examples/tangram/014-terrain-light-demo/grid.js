export const HEADER_BYTES = 32;
const predict = (v, w, x, y)=>{
    const i = y * w + x;
    if (y === 0) return x === 0 ? 0 : v[i - 1];
    if (x === 0) return v[i - w];
    return v[i - 1] + v[i - w] - v[i - w - 1];
};
export function encodeGrid(g) {
    const { w, h } = g, n = w * h;
    const out = new Uint8Array(HEADER_BYTES + 2 * n + n);
    const dv = new DataView(out.buffer);
    out.set([
        77,
        70,
        84,
        76
    ]);
    dv.setUint16(4, 1, true);
    dv.setUint16(6, w, true);
    dv.setUint16(8, h, true);
    out[10] = g.z;
    dv.setUint32(12, g.x0, true);
    dv.setUint32(16, g.y0, true);
    dv.setFloat32(20, g.q, true);
    dv.setFloat64(24, g.cell, true);
    for(let y = 0; y < h; y++)for(let x = 0; x < w; x++){
        const r = g.qh[y * w + x] - predict(g.qh, w, x, y);
        if (r < -32768 || r > 32767) throw new Error(`residual ${r} at ${x},${y} does not fit int16`);
        dv.setInt16(HEADER_BYTES + 2 * (y * w + x), r, true);
    }
    out.set(g.water, HEADER_BYTES + 2 * n);
    return out;
}
export function decodeGrid(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MFTL') throw new Error('not an MFTL grid');
    const w = dv.getUint16(6, true), h = dv.getUint16(8, true), n = w * h, q = dv.getFloat32(20, true);
    const v = new Int32Array(n), heights = new Float32Array(n);
    for(let y = 0; y < h; y++)for(let x = 0; x < w; x++){
        const i = y * w + x;
        v[i] = predict(v, w, x, y) + dv.getInt16(HEADER_BYTES + 2 * i, true);
        heights[i] = v[i] * q;
    }
    return {
        w,
        h,
        z: bytes[10],
        x0: dv.getUint32(12, true),
        y0: dv.getUint32(16, true),
        q,
        cell: dv.getFloat64(24, true),
        heights,
        water: bytes.slice(HEADER_BYTES + 2 * n, HEADER_BYTES + 3 * n)
    };
}
export function gradients(hgt, water, w, h, cell) {
    const out = new Float32Array(w * h * 4);
    for(let y = 0; y < h; y++)for(let x = 0; x < w; x++){
        const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yn = Math.max(0, y - 1), ys = Math.min(h - 1, y + 1);
        const i = y * w + x;
        out[i * 4] = (hgt[y * w + xr] - hgt[y * w + xl]) / ((xr - xl) * cell);
        out[i * 4 + 1] = (hgt[yn * w + x] - hgt[ys * w + x]) / ((ys - yn) * cell);
        out[i * 4 + 2] = water[i];
        out[i * 4 + 3] = 1;
    }
    return out;
}
export const meshSize = (w, h, step)=>({
        nx: Math.ceil((w - 1) / step) + 1,
        ny: Math.ceil((h - 1) / step) + 1
    });
export function gridIndices(nx, ny) {
    const out = new Uint32Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for(let r = 0; r < ny - 1; r++)for(let c = 0; c < nx - 1; c++){
        const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
        out[k++] = a;
        out[k++] = d;
        out[k++] = b;
        out[k++] = b;
        out[k++] = d;
        out[k++] = e;
    }
    return out;
}
export function lonLatToTexel(lon, lat, g) {
    const world = 512 * 2 ** g.z, s = Math.sin(lat * Math.PI / 180);
    return {
        i: (lon + 180) / 360 * world - g.x0,
        j: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world - g.y0
    };
}
export const texelToLocal = (i, j, g)=>({
        x: (i - g.w / 2) * g.cell,
        y: (g.h / 2 - j) * g.cell
    });
