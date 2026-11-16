export const MAGIC = 0x31424c50, VERSION = 1, HEAD = 128, ENTRY = 56, FIRST = 65536, GAP = 32768, PARALLEL = 6;
let table = null;
export function crc32(b) {
    if (!table) {
        table = new Int32Array(256);
        for(let n = 0; n < 256; n++){
            let c = n;
            for(let k = 0; k < 8; k++)c = c & 1 ? 0xedb88320 ^ c >>> 1 : c >>> 1;
            table[n] = c;
        }
    }
    let c = -1;
    for(let i = 0; i < b.length; i++)c = table[(c ^ b[i]) & 0xff] ^ c >>> 8;
    return (c ^ -1) >>> 0;
}
export function parseHeader(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    if (dv.getUint32(0, true) !== MAGIC || dv.getUint32(4, true) !== VERSION) throw new Error('not a PLB1 archive');
    const n = dv.getUint32(8, true), u = (o)=>dv.getUint32(o, true);
    const h = {
        nx: dv.getUint16(12, true),
        ny: dv.getUint16(14, true),
        tileSize: dv.getFloat64(16, true),
        lat0: dv.getFloat64(24, true),
        lon0: dv.getFloat64(32, true),
        kx: dv.getFloat64(40, true),
        ky: dv.getFloat64(48, true),
        half: dv.getFloat64(56, true),
        ground: [
            u(72),
            u(76)
        ],
        sections: [
            [
                u(80),
                u(84)
            ],
            [
                u(88),
                u(92)
            ]
        ],
        crc: u(96),
        tiles: []
    };
    if (crc32(b.subarray(HEAD, HEAD + n * ENTRY)) !== h.crc) throw new Error('PLB1 index CRC mismatch');
    for(let i = 0; i < n; i++){
        const o = HEAD + i * ENTRY;
        const lv = (p)=>({
                off: u(p),
                len: u(p + 4),
                ni: u(p + 8),
                nv: dv.getUint16(p + 12, true),
                dropped: dv.getUint16(p + 14, true)
            });
        h.tiles.push({
            i,
            tx: b[o],
            ty: b[o + 1],
            buildings: dv.getUint16(o + 2, true),
            min: [
                dv.getInt32(o + 4, true),
                dv.getInt32(o + 8, true),
                dv.getInt32(o + 12, true)
            ],
            size: [
                dv.getUint16(o + 16, true),
                dv.getUint16(o + 18, true),
                dv.getUint16(o + 20, true)
            ],
            tiny: dv.getUint16(o + 22, true),
            lv: [
                lv(o + 24),
                lv(o + 40)
            ]
        });
    }
    return h;
}
export async function inflate(b) {
    const s = new ReadableStream({
        start (c) {
            c.enqueue(b);
            c.close();
        }
    }).pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
}
export function decodeBlock(b) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const nv = dv.getUint32(0, true), ni = dv.getUint32(4, true);
    const q = new Uint16Array(3 * nv), idx = new Uint16Array(ni);
    let p = 8;
    for(let k = 0; k < 3; k++){
        for(let i = 0, v = 0; i < nv; i++, p += 2){
            const z = dv.getUint16(p, true);
            v = v + (z >>> 1 ^ -(z & 1)) & 0xffff;
            q[3 * i + k] = v;
        }
    }
    for(let i = 0, hi = 0; i < ni; i++, p += 2){
        const c = dv.getUint16(p, true);
        idx[i] = hi - c;
        if (c === 0) hi++;
    }
    return {
        q,
        idx,
        nv
    };
}
export function decodeGround(raw, head) {
    const dv = new DataView(head.buffer, head.byteOffset, 8), n = dv.getUint32(0, true), h = new Uint16Array(n * n);
    const z = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    for(let i = 0, v = 0; i < n * n; i++){
        const c = z.getUint16(2 * i, true);
        v = v + (c >>> 1 ^ -(c & 1)) & 0xffff;
        h[i] = v;
    }
    return {
        n,
        z0: dv.getInt32(4, true),
        h
    };
}
export class Archive {
    url;
    whole = null;
    head = null;
    requests = 0;
    bytes = 0;
    log = [];
    constructor(url){
        this.url = url;
    }
    async get(a, b) {
        const want = b === null ? '' : `bytes=${a}-${b}`;
        const r = await fetch(this.url, want ? {
            headers: {
                Range: want
            }
        } : {});
        const body = new Uint8Array(await r.arrayBuffer());
        this.requests++;
        this.bytes += body.byteLength;
        this.log.push({
            want,
            status: r.status,
            range: r.headers.get('content-range'),
            encoding: r.headers.get('content-encoding'),
            bytes: body.byteLength
        });
        if (!r.ok) throw new Error(`${this.url}: HTTP ${r.status}`);
        if (r.status === 200) {
            this.whole = body;
            return want ? body.subarray(a, b + 1) : body;
        }
        return body;
    }
    async open(whole = false) {
        this.head = whole ? await this.get(0, null) : await this.get(0, FIRST - 1);
        const h = parseHeader(this.head);
        if (h.ground[0] + h.ground[1] > this.head.byteLength) this.head = await this.range(0, h.ground[0] + h.ground[1]);
        return h;
    }
    async range(a, b) {
        if (this.whole) return this.whole.subarray(a, b);
        const head = this.head?.byteLength ?? 0;
        if (b <= head) return this.head.subarray(a, b);
        if (a >= head) return this.get(a, b - 1);
        const out = new Uint8Array(b - a);
        out.set(this.head.subarray(a));
        out.set(await this.get(head, b - 1), head - a);
        return out;
    }
}
export class Loader {
    ar;
    h;
    state;
    queue = [];
    inflight = 0;
    busy0 = 0;
    onBlock;
    constructor(ar, h, onBlock){
        this.ar = ar;
        this.h = h;
        this.onBlock = onBlock;
        this.state = new Uint8Array(h.tiles.length * 2);
        this.reset();
    }
    reset() {
        this.state.fill(0);
        this.h.tiles.forEach((t, i)=>{
            for(let l = 0; l < 2; l++)if (t.lv[l].len === 0) this.state[2 * i + l] = 2;
        });
        this.queue = [];
    }
    want(blocks) {
        this.queue = blocks.filter((k)=>this.state[k] === 0);
        this.pump();
    }
    pump() {
        while(this.inflight < PARALLEL && this.queue.length){
            if ((this.queue[0] & 1) === 1 && this.busy0 > 0) return;
            const first = this.queue.shift();
            const lvOf = (k)=>this.h.tiles[k >> 1].lv[k & 1];
            const same = this.h.tiles.map((_, i)=>2 * i + (first & 1)).sort((a, b)=>lvOf(a).off - lvOf(b).off);
            let i0 = same.indexOf(first), i1 = i0;
            const queued = (k)=>this.state[k] === 0 && this.queue.includes(k);
            const near = (a, b)=>lvOf(b).off - (lvOf(a).off + lvOf(a).len) < GAP;
            for(let j = i1 + 1; j < same.length; j++){
                if (!near(same[i1], same[j])) break;
                if (queued(same[j])) i1 = j;
                else if (this.state[same[j]] !== 0 && lvOf(same[j]).len) break;
            }
            for(let j = i0 - 1; j >= 0; j--){
                if (!near(same[j], same[i0])) break;
                if (queued(same[j])) i0 = j;
                else if (this.state[same[j]] !== 0 && lvOf(same[j]).len) break;
            }
            const run = same.slice(i0, i1 + 1).filter((k)=>this.state[k] === 0);
            for (const k of run)this.state[k] = 1;
            this.queue = this.queue.filter((k)=>this.state[k] === 0);
            const a = lvOf(same[i0]).off, b = lvOf(same[i1]).off + lvOf(same[i1]).len;
            this.inflight++;
            const l0 = (first & 1) === 0;
            if (l0) this.busy0++;
            this.ar.range(a, b).then(async (bytes)=>{
                await Promise.all(run.map(async (k)=>{
                    const l = lvOf(k);
                    this.onBlock(k >> 1, k & 1, decodeBlock(await inflate(bytes.subarray(l.off - a, l.off - a + l.len))));
                    this.state[k] = 2;
                }));
            }).finally(()=>{
                this.inflight--;
                if (l0) this.busy0--;
                this.pump();
            });
        }
    }
}
