export class Pyramid {
    root;
    nodes = new Map();
    index;
    constructor(index){
        this.index = index;
        const get = (L, i, j)=>{
            const key = `${L}/${i}/${j}`;
            let n = this.nodes.get(key);
            if (!n) {
                const size = index.size / 2 ** L;
                n = {
                    key,
                    L,
                    i,
                    j,
                    x0: index.x0 + i * size,
                    y0: index.y0 + j * size,
                    size,
                    own: false,
                    buildings: 0,
                    bytes: 0,
                    top: 0,
                    kids: []
                };
                this.nodes.set(key, n);
                if (L > 0) get(L - 1, i >> 1, j >> 1).kids.push(n);
            }
            return n;
        };
        this.root = get(0, 0, 0);
        for (const [L, i, j, n, h, bytes] of index.tiles){
            const node = get(L, i, j);
            node.own = true;
            node.buildings = n;
            node.bytes = bytes;
            for(let a = node, l = L, x = i, y = j; a; l--, x >>= 1, y >>= 1){
                a.top = Math.max(a.top, h);
                a = l > 0 ? this.nodes.get(`${l - 1}/${x >> 1}/${y >> 1}`) : undefined;
            }
        }
    }
}
export const sse = (error, dist, height, tanHalfFov)=>dist <= 0 ? Infinity : error * height / (2 * dist * tanHalfFov);
export function frustumPlanes(m) {
    const row = (r)=>[
            m[r],
            m[4 + r],
            m[8 + r],
            m[12 + r]
        ];
    const w = row(3), out = [];
    for (const r of [
        0,
        1,
        2
    ]){
        const v = row(r);
        out.push(w.map((x, k)=>x + v[k]), w.map((x, k)=>x - v[k]));
    }
    return out;
}
function boxVisible(planes, lo, hi) {
    for (const [a, b, c, d] of planes){
        const x = a >= 0 ? hi[0] : lo[0], y = b >= 0 ? hi[1] : lo[1], z = c >= 0 ? hi[2] : lo[2];
        if (a * x + b * y + c * z + d < 0) return false;
    }
    return true;
}
export function select(p, v) {
    const visible = [], wanted = [];
    const sseOf = new Map();
    const errors = p.index.levels;
    const walk = (n)=>{
        const drop = v.R ? ((Math.abs(n.x0) + n.size) ** 2 + (Math.abs(n.y0) + n.size) ** 2) / (2 * v.R) : 0;
        const lo = [
            n.x0 - v.eye[0],
            n.y0 - v.eye[1],
            -drop - v.eye[2]
        ];
        const hi = [
            lo[0] + n.size,
            lo[1] + n.size,
            n.top - v.eye[2]
        ];
        if (!boxVisible(v.planes, lo, hi)) return;
        const dx = Math.max(lo[0], 0, -hi[0]), dy = Math.max(lo[1], 0, -hi[1]), dz = Math.max(lo[2], 0, -hi[2]);
        const dist = Math.hypot(dx, dy, dz);
        const e = sse(errors[n.L]?.error ?? 0, dist, v.height, v.tanHalfFov);
        if (n.own) {
            visible.push(n.key);
            wanted.push([
                n.key,
                e
            ]);
            sseOf.set(n.key, e);
        }
        if (e > v.maxSSE) for (const k of n.kids)walk(k);
    };
    walk(p.root);
    wanted.sort((a, b)=>b[1] - a[1] || +a[0].split('/')[0] - +b[0].split('/')[0]);
    return {
        visible,
        want: wanted.map((w)=>w[0]),
        sse: sseOf
    };
}
export class LruBudget {
    budget;
    bytes = 0;
    used = new Map();
    constructor(budget){
        this.budget = budget;
    }
    add(key, bytes, frame) {
        const old = this.used.get(key);
        if (old) this.bytes -= old.bytes;
        this.used.set(key, {
            bytes,
            frame
        });
        this.bytes += bytes;
    }
    touch(key, frame) {
        const e = this.used.get(key);
        if (e) e.frame = frame;
    }
    has(key) {
        return this.used.has(key);
    }
    evict(keep) {
        if (this.bytes <= this.budget) return [];
        const order = [
            ...this.used
        ].filter(([k])=>!keep.has(k)).sort((a, b)=>a[1].frame - b[1].frame);
        const out = [];
        for (const [k, e] of order){
            if (this.bytes <= this.budget) break;
            this.used.delete(k);
            this.bytes -= e.bytes;
            out.push(k);
        }
        return out;
    }
}
