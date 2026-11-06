export const MAGIC = 0x3154424a;
const zig = (d)=>(d << 1 ^ d >> 31) & 0xffff;
const unzig = (v)=>v >>> 1 ^ -(v & 1);
export function quantize(v, size) {
    return Math.max(0, Math.min(65535, Math.round(v / size * 65535)));
}
export function encodeTile(list, size) {
    const nB = list.length;
    let nR = 0, nV = 0, nI = 0;
    for (const b of list){
        if (!(b.height >= 0 && b.height <= 655.35)) throw new Error(`height ${b.height} m does not fit`);
        if (b.rings.length > 255) throw new Error('too many rings');
        nR += b.rings.length;
        for (const r of b.rings)nV += r.length;
        nI += b.roof.length;
    }
    const u16 = nB + nR + 2 * nV + nB + nI;
    const buf = new ArrayBuffer(20 + 2 * u16 + nB + 1);
    const head = new Uint32Array(buf, 0, 5);
    head.set([
        MAGIC,
        nB,
        nR,
        nV,
        nI
    ]);
    const w = new Uint16Array(buf, 20, u16), per = new Uint8Array(buf, 20 + 2 * u16, nB);
    let o = 0;
    for (const b of list)w[o++] = Math.round(b.height * 100);
    for (const b of list)for (const r of b.rings)w[o++] = r.length;
    for (const axis of [
        0,
        1
    ]){
        let prev = 0;
        for (const b of list)for (const r of b.rings)for (const p of r){
            const q = quantize(p[axis], size);
            w[o++] = zig(q - prev << 16 >> 16);
            prev = q;
        }
    }
    for (const b of list)w[o++] = b.roof.length / 3;
    for (const b of list)for (const i of b.roof)w[o++] = i;
    list.forEach((b, i)=>{
        per[i] = b.rings.length;
    });
    return new Uint8Array(buf);
}
export function decodeTile(bytes) {
    const copy = bytes.byteOffset % 4 ? bytes.slice() : bytes;
    const [magic, nB, nR, nV, nI] = new Uint32Array(copy.buffer, copy.byteOffset, 5);
    if (magic !== MAGIC) throw new Error('not a JBT1 tile');
    const u16 = nB + nR + 2 * nV + nB + nI;
    const w = new Uint16Array(copy.buffer, copy.byteOffset + 20, u16), per = new Uint8Array(copy.buffer, copy.byteOffset + 20 + 2 * u16, nB);
    const H = w.subarray(0, nB), RL = w.subarray(nB, nB + nR);
    const X = w.subarray(nB + nR, nB + nR + nV), Y = w.subarray(nB + nR + nV, nB + nR + 2 * nV);
    const RT = w.subarray(nB + nR + 2 * nV, nB + nR + 2 * nV + nB), RI = w.subarray(nB + nR + 2 * nV + nB);
    const xs = new Uint16Array(nV), ys = new Uint16Array(nV);
    for(let i = 0, px = 0, py = 0; i < nV; i++){
        px = px + unzig(X[i]) & 0xffff;
        py = py + unzig(Y[i]) & 0xffff;
        xs[i] = px;
        ys[i] = py;
    }
    const chunks = [];
    let maxH = 0;
    const plan = [];
    {
        let r = 0, cur = {
            b0: 0,
            b1: 0,
            v: 0,
            i: 0
        };
        for(let b = 0; b < nB; b++){
            let m = 0;
            for(let k = 0; k < per[b]; k++)m += RL[r + k];
            r += per[b];
            if (cur.v + 2 * m > 65535 && cur.b1 > cur.b0) {
                plan.push(cur);
                cur = {
                    b0: b,
                    b1: b,
                    v: 0,
                    i: 0
                };
            }
            cur.b1 = b + 1;
            cur.v += 2 * m;
            cur.i += 6 * m + 3 * RT[b];
        }
        if (cur.b1 > cur.b0) plan.push(cur);
    }
    let r = 0, v = 0, ri = 0;
    for (const p of plan){
        const verts = new Uint16Array(4 * p.v), idx = new Uint16Array(p.i);
        let vo = 0, io = 0;
        for(let b = p.b0; b < p.b1; b++){
            const h = H[b];
            if (h / 100 > maxH) maxH = h / 100;
            let m = 0;
            for(let k = 0; k < per[b]; k++)m += RL[r + k];
            const base = vo;
            for(let k = 0; k < m; k++){
                const s = 4 * (base + k), t = 4 * (base + m + k);
                verts[s] = verts[t] = xs[v + k];
                verts[s + 1] = verts[t + 1] = ys[v + k];
                verts[s + 2] = 0;
                verts[t + 2] = h;
                verts[s + 3] = verts[t + 3] = h;
            }
            for(let k = 0, start = 0; k < per[b]; k++){
                const n = RL[r + k];
                for(let i = 0; i < n; i++){
                    const j = i + 1 < n ? i + 1 : 0;
                    const bi = base + start + i, bj = base + start + j, ti = bi + m, tj = bj + m;
                    idx[io++] = bi;
                    idx[io++] = bj;
                    idx[io++] = tj;
                    idx[io++] = bi;
                    idx[io++] = tj;
                    idx[io++] = ti;
                }
                start += n;
            }
            for(let k = 0; k < 3 * RT[b]; k++)idx[io++] = base + m + RI[ri + k];
            ri += 3 * RT[b];
            r += per[b];
            v += m;
            vo += 2 * m;
        }
        chunks.push({
            verts,
            idx,
            buildings: p.b1 - p.b0
        });
    }
    return {
        buildings: nB,
        chunks,
        maxHeight: maxH
    };
}
