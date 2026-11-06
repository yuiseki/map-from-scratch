export const HEADER_BYTES = 32;
const MAGIC = 0x48534d46;
export const terrarium = (r, g, b)=>r * 256 + g + b / 256 - 32768;
export function encodeHeights(src, w, h, m) {
    const out = new Uint8Array(HEADER_BYTES + w * h * 2);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, MAGIC, true);
    dv.setUint16(4, w, true);
    dv.setUint16(6, h, true);
    dv.setUint8(8, m.z);
    dv.setUint32(12, m.x0, true);
    dv.setUint32(16, m.y0, true);
    dv.setFloat32(20, m.step, true);
    dv.setFloat32(24, m.q, true);
    let rowStart = 0;
    for(let y = 0; y < h; y++){
        let prev = rowStart;
        for(let x = 0; x < w; x++){
            const v = Math.round(src[y * w + x] / m.q);
            const d = x === 0 ? v - rowStart : v - prev;
            dv.setInt16(HEADER_BYTES + (y * w + x) * 2, (d + 32768 & 0xffff) - 32768, true);
            if (x === 0) rowStart = v;
            prev = v;
        }
    }
    return out;
}
export function decodeHeights(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint32(0, true) !== MAGIC) throw new Error('heights: bad magic');
    const w = dv.getUint16(4, true), h = dv.getUint16(6, true);
    const q = dv.getFloat32(24, true);
    if (u8.byteLength < HEADER_BYTES + w * h * 2) throw new Error('heights: truncated');
    const heights = new Float32Array(w * h);
    let rowStart = 0;
    for(let y = 0; y < h; y++){
        let v = 0;
        for(let x = 0; x < w; x++){
            const d = dv.getInt16(HEADER_BYTES + (y * w + x) * 2, true);
            v = ((x === 0 ? rowStart + d : v + d) + 32768 & 0xffff) - 32768;
            if (x === 0) rowStart = v;
            heights[y * w + x] = v * q;
        }
    }
    return {
        w,
        h,
        q,
        z: dv.getUint8(8),
        x0: dv.getUint32(12, true),
        y0: dv.getUint32(16, true),
        step: dv.getFloat32(20, true),
        heights
    };
}
export function sampleHeight(g, ox, oy, x, y) {
    const fx = (x - ox) / g.step, fy = (oy - y) / g.step;
    if (!(fx >= 0 && fy >= 0 && fx <= g.w - 1 && fy <= g.h - 1)) return null;
    const ix = Math.min(Math.floor(fx), g.w - 2), iy = Math.min(Math.floor(fy), g.h - 2);
    const tx = fx - ix, ty = fy - iy, H = g.heights, w = g.w;
    const a = H[iy * w + ix], b = H[iy * w + ix + 1], c = H[(iy + 1) * w + ix], d = H[(iy + 1) * w + ix + 1];
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}
