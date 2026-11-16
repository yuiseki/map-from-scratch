export const CS = 128;
export const S = CS + 3;
export const LEVELS = 4;
export const N0 = 3072;
export const HEADER_BYTES = 64, ENTRY_BYTES = 8;
export const FIRST_BYTES = 98304;
export const FOV_Y = 40;
export const R_EFF = 6371000 / (1 - 0.13);
export const perSide = (k)=>N0 / CS >> k;
function morton(i, j) {
    let m = 0;
    for(let b = 0; b < 8; b++)m |= (j >> b & 1) << 2 * b | (i >> b & 1) << 2 * b + 1;
    return m;
}
export function fileOrder() {
    const out = [];
    for(let k = LEVELS - 1; k >= 0; k--){
        const n = perSide(k), cells = [];
        for(let i = 0; i < n; i++)for(let j = 0; j < n; j++)cells.push([
            morton(i, j),
            i,
            j
        ]);
        cells.sort((a, b)=>a[0] - b[0]);
        for (const [, i, j] of cells)out.push([
            k,
            i,
            j
        ]);
    }
    return out;
}
export function parseTerr(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (String.fromCharCode(...u8.subarray(0, 4)) !== 'MFST' || dv.getUint16(4, true) !== 1) throw new Error('not a .terr v1 file');
    if (dv.getUint16(6, true) !== CS || u8[8] !== 1 || u8[9] !== LEVELS) throw new Error('.terr: unexpected chunk layout');
    const n = dv.getUint16(10, true);
    const t = {
        x0: dv.getUint32(12, true),
        y0: dv.getUint32(16, true),
        block: u8[20],
        cell: dv.getFloat64(24, true),
        lat0: dv.getFloat64(32, true),
        lon0: dv.getFloat64(40, true),
        q0: dv.getFloat32(48, true),
        chunks: [],
        ids: Array.from({
            length: LEVELS
        }, (_, k)=>new Int32Array(perSide(k) ** 2))
    };
    let off = HEADER_BYTES + ENTRY_BYTES * n;
    fileOrder().forEach(([k, i, j], c)=>{
        const e = HEADER_BYTES + ENTRY_BYTES * c, len = dv.getUint16(e, true);
        t.chunks.push({
            k,
            i,
            j,
            off,
            len,
            hmin: dv.getUint16(e + 2, true) / 4,
            hmax: dv.getUint16(e + 4, true) / 4,
            skirt: u8[e + 6] * 2
        });
        t.ids[k][i * perSide(k) + j] = c;
        off += len;
    });
    if (t.chunks.length !== n) throw new Error('.terr: chunk count mismatch');
    return t;
}
const predict = (o, r, c, base)=>{
    const t = r * S + c;
    return r && c ? o[t - 1] + o[t - S] - o[t - S - 1] : r ? o[t - S] : c ? o[t - 1] : base;
};
export function encodeChunk(q, block = 32) {
    const n = S * S, z = new Uint32Array(n);
    for(let r = 0, t = 0; r < S; r++)for(let c = 0; c < S; c++, t++){
        const d = q[t] - predict(q, r, c, q[0]);
        z[t] = d >= 0 ? 2 * d : -2 * d - 1;
    }
    const out = new Uint8Array(2 + n * 8);
    out[0] = q[0] & 255;
    out[1] = q[0] >> 8;
    let pos = 16;
    const put = (v, bits)=>{
        for(let b = bits - 1; b >= 0; b--, pos++)if (v >> b & 1) out[pos >> 3] |= 0x80 >> (pos & 7);
    };
    for(let s = 0; s < n; s += block){
        const e = Math.min(n, s + block);
        let best = 0, cost = Infinity;
        for(let k = 0; k < 15; k++){
            let c = 0;
            for(let t = s; t < e; t++)c += (z[t] >>> k) + 1 + k;
            if (c < cost) {
                cost = c;
                best = k;
            }
        }
        put(best, 4);
        for(let t = s; t < e; t++){
            pos += z[t] >>> best;
            out[pos >> 3] |= 0x80 >> (pos & 7);
            pos++;
            put(z[t] & (1 << best) - 1, best);
        }
    }
    return out.slice(0, pos + 7 >> 3);
}
export function decodeChunk(src, out, block = 32) {
    const base = src[0] | src[1] << 8;
    let p = 2, win = 0, avail = 0, k = 0;
    for(let r = 0, t = 0; r < S; r++)for(let c = 0; c < S; c++, t++){
        while(avail <= 24){
            win |= (src[p++] | 0) << 24 - avail;
            avail += 8;
        }
        if (t % block === 0) {
            k = win >>> 28;
            win <<= 4;
            avail -= 4;
        }
        let u = 0;
        while(win === 0){
            u += avail;
            avail = 0;
            while(avail <= 24){
                win |= (src[p++] | 0) << 24 - avail;
                avail += 8;
            }
        }
        const lz = Math.clz32(win);
        u += lz;
        win = lz === 31 ? 0 : win << lz + 1;
        avail -= lz + 1;
        while(avail <= 24){
            win |= (src[p++] | 0) << 24 - avail;
            avail += 8;
        }
        let zz = u << k;
        if (k) {
            zz |= win >>> 32 - k;
            win <<= k;
            avail -= k;
        }
        out[t] = predict(out, r, c, base) + (zz >>> 1 ^ -(zz & 1));
    }
}
const sub = (a, b)=>a.map((v, i)=>v - b[i]);
const dot = (a, b)=>a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b)=>[
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ];
const norm = (a)=>{
    const l = Math.hypot(a[0], a[1], a[2]);
    return a.map((v)=>v / l);
};
export function makeView(c, w, h, ground) {
    const yaw = c.yaw * Math.PI / 180, pitch = c.pitch * Math.PI / 180;
    const fwd0 = [
        Math.sin(yaw) * Math.cos(pitch),
        Math.cos(yaw) * Math.cos(pitch),
        -Math.sin(pitch)
    ];
    const eye = [
        c.tx - fwd0[0] * c.dist,
        c.ty - fwd0[1] * c.dist,
        c.tz - fwd0[2] * c.dist
    ];
    eye[2] = Math.max(eye[2], ground(eye[0], eye[1]) + 150);
    const fwd = norm(sub([
        c.tx,
        c.ty,
        c.tz
    ], eye));
    const right = norm(cross(fwd, [
        0,
        0,
        1
    ])), up = cross(right, fwd);
    const near = Math.min(500, Math.max(30, 0.005 * c.dist)), far = c.dist + 80000;
    const fy = 1 / Math.tan(FOV_Y / 2 * Math.PI / 180), fx = fy * h / w;
    const rows = [
        right.map((v)=>v * fx),
        up.map((v)=>v * fy)
    ];
    const za = (far + near) / (near - far), zb = 2 * far * near / (near - far);
    const m = new Float32Array(16);
    for(let col = 0; col < 3; col++){
        m[col * 4] = rows[0][col];
        m[col * 4 + 1] = rows[1][col];
        m[col * 4 + 2] = -fwd[col] * za;
        m[col * 4 + 3] = fwd[col];
    }
    m[12] = -dot(rows[0], eye);
    m[13] = -dot(rows[1], eye);
    m[14] = dot(fwd, eye) * za + zb;
    m[15] = -dot(fwd, eye);
    return {
        eye,
        fwd,
        right,
        up,
        f: h / 2 * fy,
        w,
        h,
        near,
        far,
        m
    };
}
export function groundMax(t, x, y) {
    const cl = (v)=>Math.min(N0 / CS - 1, Math.max(0, Math.floor(v / CS)));
    return t.chunks[t.ids[0][cl(N0 / 2 - y / t.cell) * perSide(0) + cl(x / t.cell + N0 / 2)]].hmax;
}
export function project(v, p) {
    const d = sub(p, v.eye), z = dot(d, v.fwd);
    if (z <= v.near) return null;
    return [
        v.w / 2 + dot(d, v.right) * v.f / z,
        v.h / 2 - dot(d, v.up) * v.f / z
    ];
}
export function vertexPos(u) {
    return u === 0 ? 0 : u === CS ? CS : u + 0.5;
}
function chunkBox(t, ch) {
    const s = 2 ** ch.k, px = (u)=>(u * s - N0 / 2) * t.cell;
    return [
        px(ch.j * CS),
        px(ch.j * CS + CS),
        -px(ch.i * CS + CS),
        -px(ch.i * CS)
    ];
}
export function select(t, v, tau, loaded) {
    const sel = {
        draw: [],
        want: [],
        fallback: 0,
        uncovered: 0,
        dist: new Float64Array(t.chunks.length)
    };
    const tanY = Math.tan(FOV_Y / 2 * Math.PI / 180), tanX = tanY * v.w / v.h;
    const corner = [
        0,
        0,
        0
    ];
    const visit = (k, i, j)=>{
        const id = t.ids[k][i * perSide(k) + j], ch = t.chunks[id];
        const [x0, x1, y0, y1] = chunkBox(t, ch);
        const dx = Math.max(Math.abs(x0 - v.eye[0]), Math.abs(x1 - v.eye[0])), dy = Math.max(Math.abs(y0 - v.eye[1]), Math.abs(y1 - v.eye[1]));
        const z0 = ch.hmin - ch.skirt - (dx * dx + dy * dy) / (2 * R_EFF), z1 = ch.hmax;
        let out = [
            0,
            0,
            0,
            0,
            0
        ];
        for(let c = 0; c < 8; c++){
            corner[0] = (c & 1 ? x1 : x0) - v.eye[0];
            corner[1] = (c & 2 ? y1 : y0) - v.eye[1];
            corner[2] = (c & 4 ? z1 : z0) - v.eye[2];
            const zc = dot(corner, v.fwd), xc = dot(corner, v.right), yc = dot(corner, v.up);
            if (zc < v.near) out[0]++;
            if (xc < -tanX * zc) out[1]++;
            if (xc > tanX * zc) out[2]++;
            if (yc < -tanY * zc) out[3]++;
            if (yc > tanY * zc) out[4]++;
        }
        if (out.includes(8)) return [];
        const cx = Math.min(Math.max(v.eye[0], x0), x1) - v.eye[0], cy = Math.min(Math.max(v.eye[1], y0), y1) - v.eye[1];
        const cz = Math.min(Math.max(v.eye[2], z0), z1) - v.eye[2];
        const d = Math.max(Math.hypot(cx, cy, cz), 1);
        sel.dist[id] = d;
        if (k > 0 && t.cell * 2 ** k * v.f / d > tau) {
            const parts = [];
            let missing = false;
            for(let c = 0; c < 4; c++){
                const p = visit(k - 1, 2 * i + (c >> 1), 2 * j + (c & 1));
                if (p) parts.push(p);
                else missing = true;
            }
            if (!missing) return parts.flat();
            sel.fallback++;
            return loaded(id) ? [
                id
            ] : null;
        }
        sel.want.push(id);
        return loaded(id) ? [
            id
        ] : null;
    };
    for(let i = 0; i < 3; i++)for(let j = 0; j < 3; j++){
        const d = visit(LEVELS - 1, i, j);
        if (d) sel.draw.push(...d);
        else sel.uncovered++;
    }
    sel.draw.sort((a, b)=>sel.dist[a] - sel.dist[b]);
    return sel;
}
export function ranges(t, ids, gap = 8192) {
    const out = [];
    for (const id of [
        ...ids
    ].sort((a, b)=>a - b)){
        const { off, len } = t.chunks[id], last = out[out.length - 1];
        if (last && off - last.end <= gap) {
            last.end = Math.max(last.end, off + len);
            last.ids.push(id);
        } else out.push({
            start: off,
            end: off + len,
            ids: [
                id
            ]
        });
    }
    return out;
}
export function origTile(t, ch) {
    return [
        12 - ch.k,
        (t.x0 >> ch.k) + ch.j * CS >> 9,
        (t.y0 >> ch.k) + ch.i * CS >> 9
    ];
}
