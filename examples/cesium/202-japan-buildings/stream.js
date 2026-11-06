import { Pyramid, select, LruBudget } from './lod.js';
import { decodeTile } from './tile.js';
const MAX_FETCH = 6;
const UPLOAD_MS = 6;
export class TileStream {
    gl;
    pyramid;
    base;
    lru;
    gpu = new Map();
    inflight = new Set();
    arrived = [];
    failed = new Set();
    frame = 0;
    requests = 0;
    bytesFetched = 0;
    evicted = 0;
    decodeMs = [];
    onArrive = ()=>{};
    wanted = 0;
    constructor(gl, index, base, budgetBytes){
        this.gl = gl;
        this.pyramid = new Pyramid(index);
        this.base = base;
        this.lru = new LruBudget(budgetBytes);
    }
    get pending() {
        return this.inflight.size + this.arrived.length;
    }
    update(view) {
        this.frame++;
        const sel = select(this.pyramid, view);
        const visible = new Set(sel.visible);
        let missing = 0;
        for (const key of sel.want){
            if (this.gpu.has(key) || this.failed.has(key)) continue;
            missing++;
            if (this.inflight.has(key) || this.arrived.some((a)=>a.key === key) || this.inflight.size >= MAX_FETCH) continue;
            this.fetch(key);
        }
        this.wanted = missing;
        const t0 = performance.now();
        this.arrived.sort((a, b)=>+visible.has(b.key) - +visible.has(a.key));
        while(this.arrived.length && performance.now() - t0 < UPLOAD_MS){
            const a = this.arrived.shift();
            const t = performance.now();
            this.upload(a.key, a.bytes);
            this.decodeMs.push(performance.now() - t);
        }
        this.arrived = this.arrived.filter((a)=>visible.has(a.key) || this.arrived.length < 64);
        const draw = [];
        for (const key of sel.visible){
            const t = this.gpu.get(key);
            if (t) {
                draw.push(t);
                this.lru.touch(key, this.frame);
            }
        }
        for (const key of this.lru.evict(visible))this.free(key);
        return draw;
    }
    async fetch(key) {
        this.inflight.add(key);
        this.requests++;
        try {
            const res = await fetch(`${this.base}t/${key}.bin`);
            if (!res.ok || !res.body) throw new Error(`${key}: HTTP ${res.status}`);
            const raw = await res.clone().arrayBuffer();
            this.bytesFetched += raw.byteLength;
            const out = await new Response(new Blob([
                raw
            ]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
            this.arrived.push({
                key,
                bytes: new Uint8Array(out)
            });
        } catch (e) {
            console.error(e);
            this.failed.add(key);
        } finally{
            this.inflight.delete(key);
            this.onArrive();
        }
    }
    upload(key, bytes) {
        const gl = this.gl, mesh = decodeTile(bytes), node = this.pyramid.nodes.get(key);
        const chunks = [];
        let total = 0;
        for (const c of mesh.chunks){
            const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
            gl.bindVertexArray(vao);
            gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
            gl.bufferData(gl.ARRAY_BUFFER, c.verts, gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, 8, 0);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
            gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, c.idx, gl.STATIC_DRAW);
            gl.bindVertexArray(null);
            chunks.push({
                vao,
                vbo,
                ibo,
                count: c.idx.length
            });
            total += c.verts.byteLength + c.idx.byteLength;
        }
        this.gpu.set(key, {
            node,
            chunks,
            bytes: total,
            buildings: mesh.buildings
        });
        this.lru.add(key, total, this.frame);
    }
    free(key) {
        const t = this.gpu.get(key);
        if (!t) return;
        for (const c of t.chunks){
            this.gl.deleteVertexArray(c.vao);
            this.gl.deleteBuffer(c.vbo);
            this.gl.deleteBuffer(c.ibo);
        }
        this.gpu.delete(key);
        this.evicted++;
    }
}
