const LINE_Q = 1e6, LAND_Q = 1e5;
export function encodeLines(lines) {
    const n = lines.reduce((s, l)=>s + l.length, 0);
    const out = new Int32Array(1 + lines.length + 2 * n);
    out[0] = lines.length;
    let o = 1 + lines.length;
    lines.forEach((l, i)=>{
        out[1 + i] = l.length;
        let px = 0, py = 0;
        for (const [lon, lat] of l){
            const x = Math.round(lon * LINE_Q), y = Math.round(lat * LINE_Q);
            out[o++] = x - px;
            out[o++] = y - py;
            px = x;
            py = y;
        }
    });
    return new Uint8Array(out.buffer);
}
export function decodeLines(buf) {
    const a = new Int32Array(buf), n = a[0], out = [];
    let o = 1 + n;
    for(let i = 0; i < n; i++){
        const c = a[1 + i], l = new Float64Array(2 * c);
        let x = 0, y = 0;
        for(let k = 0; k < c; k++){
            x += a[o++];
            y += a[o++];
            l[2 * k] = x / LINE_Q;
            l[2 * k + 1] = y / LINE_Q;
        }
        out.push(l);
    }
    return out;
}
export function encodeLand(layers) {
    const words = 1 + layers.reduce((s, l)=>s + 2 + l.vertices.length + l.indices.length, 0);
    const out = new Int32Array(words), u = new Uint32Array(out.buffer);
    out[0] = layers.length;
    let o = 1;
    for (const l of layers){
        out[o++] = l.vertices.length / 2;
        out[o++] = l.indices.length;
        let px = 0, py = 0;
        for(let i = 0; i < l.vertices.length; i += 2){
            const x = Math.round(l.vertices[i] * LAND_Q), y = Math.round(l.vertices[i + 1] * LAND_Q);
            out[o++] = x - px;
            out[o++] = y - py;
            px = x;
            py = y;
        }
        for(let i = 0; i < l.indices.length; i++)u[o++] = l.indices[i];
    }
    return new Uint8Array(out.buffer);
}
export function decodeLand(buf) {
    const a = new Int32Array(buf), out = [];
    let o = 1;
    for(let k = 0; k < a[0]; k++){
        const nv = a[o++], ni = a[o++], vertices = new Float64Array(2 * nv);
        let x = 0, y = 0;
        for(let i = 0; i < nv; i++){
            x += a[o++];
            y += a[o++];
            vertices[2 * i] = x / LAND_Q;
            vertices[2 * i + 1] = y / LAND_Q;
        }
        out.push({
            vertices,
            indices: new Uint32Array(buf, o * 4, ni)
        });
        o += ni;
    }
    return out;
}
