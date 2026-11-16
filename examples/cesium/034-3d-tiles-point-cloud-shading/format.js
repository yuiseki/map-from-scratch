export const nodeBytes = (count)=>count * 9;
export function encodeNode(xyz, rgb, min, max) {
    const count = xyz.length / 3;
    const out = new Uint8Array(nodeBytes(count));
    const q = new Uint16Array(out.buffer, 0, count * 3);
    for(let i = 0; i < count * 3; i++){
        const a = i % 3, extent = max[a] - min[a];
        q[i] = extent > 0 ? Math.max(0, Math.min(65535, Math.round((xyz[i] - min[a]) / extent * 65535))) : 0;
    }
    out.set(rgb.subarray(0, count * 3), count * 6);
    return out;
}
export function decodeNode(buffer, count) {
    if (buffer.byteLength < nodeBytes(count)) throw new Error(`node file is ${buffer.byteLength} bytes, expected ${nodeBytes(count)}`);
    return {
        q: new Uint16Array(buffer, 0, count * 3),
        rgb: new Uint8Array(buffer, count * 6, count * 3)
    };
}
export const surfaceSpacing = (min, max, count)=>Math.sqrt((max[0] - min[0]) * (max[1] - min[1]) / Math.max(1, count));
