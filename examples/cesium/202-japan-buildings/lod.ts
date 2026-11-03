// What to draw and what to load: a baked quadtree of building tiles with
// additive refinement (3D Tiles' refine: ADD). Level L holds the buildings
// whose height is at least levels[L].minHeight and below the level above's,
// so a parent never has to be hidden for its children: no holes while a
// child is loading. A tile's geometric error is the tallest building it
// leaves to its descendants; the camera refines a node while that error
// covers more than maxSSE pixels (Cesium's maximumScreenSpaceError).
// Levels with no buildings in a node are absent, so traversal walks virtual
// nodes that have content somewhere below.
import type { V3 } from './geo.ts';
import type { M4 } from './camera.ts';

export interface IndexJson {
  origin: [number, number];      // lat, lon of the local frame
  R: number;                     // ground sphere radius
  x0: number; y0: number; size: number;    // the root square, local metres
  levels: { minHeight: number; error: number }[];
  tiles: [number, number, number, number, number, number][];   // level, i, j, buildings, max height (m), file bytes
}

export interface Node {
  key: string; L: number; i: number; j: number;
  x0: number; y0: number; size: number;
  own: boolean; buildings: number; bytes: number;
  top: number;                   // tallest building in this node's subtree
  kids: Node[];
}

export class Pyramid {
  root: Node;
  nodes = new Map<string, Node>();
  index: IndexJson;
  constructor(index: IndexJson) {
    this.index = index;
    const get = (L: number, i: number, j: number): Node => {
      const key = `${L}/${i}/${j}`;
      let n = this.nodes.get(key);
      if (!n) {
        const size = index.size / 2 ** L;
        n = { key, L, i, j, x0: index.x0 + i * size, y0: index.y0 + j * size, size, own: false, buildings: 0, bytes: 0, top: 0, kids: [] };
        this.nodes.set(key, n);
        if (L > 0) get(L - 1, i >> 1, j >> 1).kids.push(n);
      }
      return n;
    };
    this.root = get(0, 0, 0);
    for (const [L, i, j, n, h, bytes] of index.tiles) {
      const node = get(L, i, j);
      node.own = true; node.buildings = n; node.bytes = bytes;
      for (let a: Node | undefined = node, l = L, x = i, y = j; a; l--, x >>= 1, y >>= 1) {
        a.top = Math.max(a.top, h);
        a = l > 0 ? this.nodes.get(`${l - 1}/${x >> 1}/${y >> 1}`) : undefined;
      }
    }
  }
}

export interface View {
  eye: V3;                       // local metres
  planes: number[][];            // eye-relative clip planes (a, b, c, d), inside >= 0
  height: number;                // viewport height, px
  tanHalfFov: number;
  maxSSE: number;
  R?: number;                    // ground sphere radius: boxes sink with the curvature
}

export const sse = (error: number, dist: number, height: number, tanHalfFov: number): number =>
  dist <= 0 ? Infinity : (error * height) / (2 * dist * tanHalfFov);

// Gribb-Hartmann: the six planes of a view-projection matrix.
export function frustumPlanes(m: M4): number[][] {
  const row = (r: number) => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const w = row(3), out: number[][] = [];
  for (const r of [0, 1, 2]) {
    const v = row(r);
    out.push(w.map((x, k) => x + v[k]), w.map((x, k) => x - v[k]));
  }
  return out;
}

function boxVisible(planes: number[][], lo: V3, hi: V3): boolean {
  for (const [a, b, c, d] of planes) {
    // The corner furthest along the plane normal.
    const x = a >= 0 ? hi[0] : lo[0], y = b >= 0 ? hi[1] : lo[1], z = c >= 0 ? hi[2] : lo[2];
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

export interface Selection { visible: string[]; want: string[]; sse: Map<string, number> }

export function select(p: Pyramid, v: View): Selection {
  const visible: string[] = [], wanted: [string, number][] = [];
  const sseOf = new Map<string, number>();
  const errors = p.index.levels;
  const walk = (n: Node): void => {
    // The box in eye-relative coordinates. The ground under a 15 km area
    // drops up to ~4 m with the curvature: widen the box downwards by it.
    const drop = v.R ? ((Math.abs(n.x0) + n.size) ** 2 + (Math.abs(n.y0) + n.size) ** 2) / (2 * v.R) : 0;
    const lo: V3 = [n.x0 - v.eye[0], n.y0 - v.eye[1], -drop - v.eye[2]];
    const hi: V3 = [lo[0] + n.size, lo[1] + n.size, n.top - v.eye[2]];
    if (!boxVisible(v.planes, lo, hi)) return;
    const dx = Math.max(lo[0], 0, -hi[0]), dy = Math.max(lo[1], 0, -hi[1]), dz = Math.max(lo[2], 0, -hi[2]);
    const dist = Math.hypot(dx, dy, dz);
    const e = sse(errors[n.L]?.error ?? 0, dist, v.height, v.tanHalfFov);
    if (n.own) { visible.push(n.key); wanted.push([n.key, e]); sseOf.set(n.key, e); }
    if (e > v.maxSSE) for (const k of n.kids) walk(k);
  };
  walk(p.root);
  // Load the largest error first; ties (Infinity) by level, coarse first.
  wanted.sort((a, b) => b[1] - a[1] || +a[0].split('/')[0] - +b[0].split('/')[0]);
  return { visible, want: wanted.map((w) => w[0]), sse: sseOf };
}

// GPU memory under a budget: least recently used first, never a tile the
// current frame draws.
export class LruBudget {
  budget: number;
  bytes = 0;
  private used = new Map<string, { bytes: number; frame: number }>();
  constructor(budget: number) { this.budget = budget; }
  add(key: string, bytes: number, frame: number): void {
    const old = this.used.get(key);
    if (old) this.bytes -= old.bytes;
    this.used.set(key, { bytes, frame });
    this.bytes += bytes;
  }
  touch(key: string, frame: number): void { const e = this.used.get(key); if (e) e.frame = frame; }
  has(key: string): boolean { return this.used.has(key); }
  evict(keep: Set<string>): string[] {
    if (this.bytes <= this.budget) return [];
    const order = [...this.used].filter(([k]) => !keep.has(k)).sort((a, b) => a[1].frame - b[1].frame);
    const out: string[] = [];
    for (const [k, e] of order) {
      if (this.bytes <= this.budget) break;
      this.used.delete(k);
      this.bytes -= e.bytes;
      out.push(k);
    }
    return out;
  }
}
