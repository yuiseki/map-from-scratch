// Streaming building tiles: what lod.ts selects is fetched (at most MAX_FETCH
// at a time, largest screen-space error first), inflated by the browser
// (DecompressionStream), and decoded and uploaded inside the frame under a
// time budget, so a frame never waits for the network and never does more
// than UPLOAD_MS of tile work. GPU memory stays under a budget by evicting
// the least recently drawn tiles (lod.ts LruBudget).
import { Pyramid, select, LruBudget, type IndexJson, type View, type Node } from './lod.ts';
import { decodeTile } from './tile.ts';

const MAX_FETCH = 6;
const UPLOAD_MS = 6;

export interface GpuChunk { vao: WebGLVertexArrayObject; vbo: WebGLBuffer; ibo: WebGLBuffer; count: number }
export interface GpuTile { node: Node; chunks: GpuChunk[]; bytes: number; buildings: number }

export class TileStream {
  gl: WebGL2RenderingContext;
  pyramid: Pyramid;
  base: string;
  lru: LruBudget;
  gpu = new Map<string, GpuTile>();
  private inflight = new Set<string>();
  private arrived: { key: string; bytes: Uint8Array }[] = [];
  private failed = new Set<string>();
  frame = 0;
  // Counters for the page and the bench.
  requests = 0; bytesFetched = 0; evicted = 0; decodeMs: number[] = [];
  onArrive: () => void = () => {};
  wanted = 0;

  constructor(gl: WebGL2RenderingContext, index: IndexJson, base: string, budgetBytes: number) {
    this.gl = gl;
    this.pyramid = new Pyramid(index);
    this.base = base;
    this.lru = new LruBudget(budgetBytes);
  }

  get pending(): number { return this.inflight.size + this.arrived.length; }

  // Called once per frame: choose, start fetches, upload what arrived (within
  // the time budget), evict over budget. Returns the tiles to draw now.
  update(view: View): GpuTile[] {
    this.frame++;
    const sel = select(this.pyramid, view);
    const visible = new Set(sel.visible);
    let missing = 0;
    for (const key of sel.want) {
      if (this.gpu.has(key) || this.failed.has(key)) continue;
      missing++;
      if (this.inflight.has(key) || this.arrived.some((a) => a.key === key) || this.inflight.size >= MAX_FETCH) continue;
      this.fetch(key);
    }
    this.wanted = missing;
    // Upload: the arrived tiles that are still visible first.
    const t0 = performance.now();
    this.arrived.sort((a, b) => +visible.has(b.key) - +visible.has(a.key));
    while (this.arrived.length && performance.now() - t0 < UPLOAD_MS) {
      const a = this.arrived.shift()!;
      const t = performance.now();
      this.upload(a.key, a.bytes);
      this.decodeMs.push(performance.now() - t);
    }
    // Drop arrived tiles nobody wants any more (the camera flew on).
    this.arrived = this.arrived.filter((a) => visible.has(a.key) || this.arrived.length < 64);
    const draw: GpuTile[] = [];
    for (const key of sel.visible) {
      const t = this.gpu.get(key);
      if (t) { draw.push(t); this.lru.touch(key, this.frame); }
    }
    for (const key of this.lru.evict(visible)) this.free(key);
    return draw;
  }

  private async fetch(key: string): Promise<void> {
    this.inflight.add(key);
    this.requests++;
    try {
      const res = await fetch(`${this.base}t/${key}.bin`);
      if (!res.ok || !res.body) throw new Error(`${key}: HTTP ${res.status}`);
      const raw = await res.clone().arrayBuffer();
      this.bytesFetched += raw.byteLength;
      const out = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      this.arrived.push({ key, bytes: new Uint8Array(out) });
    } catch (e) {
      console.error(e);
      this.failed.add(key);
    } finally {
      this.inflight.delete(key);
      this.onArrive();
    }
  }

  private upload(key: string, bytes: Uint8Array): void {
    const gl = this.gl, mesh = decodeTile(bytes), node = this.pyramid.nodes.get(key)!;
    const chunks: GpuChunk[] = [];
    let total = 0;
    for (const c of mesh.chunks) {
      const vao = gl.createVertexArray()!, vbo = gl.createBuffer()!, ibo = gl.createBuffer()!;
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, c.verts, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 4, gl.UNSIGNED_SHORT, false, 8, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, c.idx, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      chunks.push({ vao, vbo, ibo, count: c.idx.length });
      total += c.verts.byteLength + c.idx.byteLength;
    }
    this.gpu.set(key, { node, chunks, bytes: total, buildings: mesh.buildings });
    this.lru.add(key, total, this.frame);
  }

  private free(key: string): void {
    const t = this.gpu.get(key);
    if (!t) return;
    for (const c of t.chunks) { this.gl.deleteVertexArray(c.vao); this.gl.deleteBuffer(c.vbo); this.gl.deleteBuffer(c.ibo); }
    this.gpu.delete(key);
    this.evicted++;
  }
}
