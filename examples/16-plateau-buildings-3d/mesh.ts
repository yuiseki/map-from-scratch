// From parsed CityGML buildings to the meshes the renderer draws: projection,
// tile assignment, triangulation, welding and 1 cm quantisation. The bake
// uses it to write PLB1 blocks; the ?citygml=1 page mode uses the same code
// on the original files, so both paths draw the same triangles.
import earcut from '../../kits/earcut/earcut.ts';
import type { Building, Poly } from './gml.ts';

// Tokyo Station; the area is the 2 km square around it, in 8 x 8 tiles.
export const LAT0 = 35.68124, LON0 = 139.76712, HALF = 1000, TILE = 250, NT = 8;

// Local equidistant frame (x east, y north, metres; z = JGD2011 height):
// GRS80 meridian (M) and prime vertical (N) radii of curvature at LAT0.
// Over +-1.3 km the scale error is below 1e-4 (13 cm at the far corner).
const A = 6378137, F = 1 / 298.257222101, E2 = F * (2 - F), RAD = Math.PI / 180;
const W = 1 - E2 * Math.sin(LAT0 * RAD) ** 2;
export const KX = (A / Math.sqrt(W)) * Math.cos(LAT0 * RAD) * RAD;
export const KY = ((A * (1 - E2)) / W ** 1.5) * RAD;

// The third-level meshes (30" x 45", one building GML each) touching the
// area, sampled every 100 m, edges included.
export function areaMeshes(): string[] {
  const code = (lat: number, lon: number): string => {
    const a = lat * 1.5, b = lon - 100, p = Math.floor(a), u = Math.floor(b), q = Math.floor((a - p) * 8), v = Math.floor((b - u) * 8);
    return `${p}${u}${q}${v}${Math.floor(((a - p) * 8 - q) * 10)}${Math.floor(((b - u) * 8 - v) * 10)}`;
  };
  const out = new Set<string>();
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) out.add(code(LAT0 + ((i / 10 - 1) * HALF) / KY, LON0 + ((j / 10 - 1) * HALF) / KX));
  return [...out].sort();
}

export interface Placed { b: Building; x: number; y: number; tile: number }

// A building belongs to the tile of the mean of its lod1Solid vertices
// (closing points included, the same rule as truth.sql). Not clipped: a
// building crossing a tile edge stays whole in one tile.
export function place(b: Building): Placed | null {
  let la = 0, lo = 0, n = 0;
  for (const poly of b.lod1) for (const r of poly) for (let i = 0; i < r.length; i += 3) { la += r[i]; lo += r[i + 1]; n++; }
  if (n === 0) return null;
  const x = (lo / n - LON0) * KX, y = (la / n - LAT0) * KY;
  if (!(x >= -HALF && x < HALF && y >= -HALF && y < HALF)) return null;
  return { b, x, y, tile: Math.floor((y + HALF) / TILE) * NT + Math.floor((x + HALF) / TILE) };
}
export const level0 = (b: Building): Poly[] => (b.lod2.length ? b.lod2 : b.lod1);

// Triangles the formula expects for a polygon: (vertices - 2) + 2 per hole,
// counting each ring's points without its closing point. truth.sql computes
// the same from the text, so dropped = expected - emitted is checkable.
export const expectedTriangles = (p: ArrayLike<number>[]): number => p.reduce((s, r, i) => s + r.length / 3 - 1 + (i ? 2 : 0), -2);

// Morton code of a point of the area (16 bits per axis).
function morton(x: number, y: number): number {
  const q = (v: number) => Math.max(0, Math.min(65535, Math.floor(((v + HALF) / (2 * HALF)) * 65536)));
  let a = q(x), b = q(y), m = 0;
  for (let i = 15; i >= 0; i--) m = m * 4 + ((b >> i) & 1) * 2 + ((a >> i) & 1);
  return m;
}

// Hilbert index of a tile in the 8 x 8 grid: the file order of the blocks.
export function hilbert(x: number, y: number, n = NT): number {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } [x, y] = [y, x]; }
  }
  return d;
}

export interface LevelMesh {
  q: Uint16Array;       // x, y, z per vertex, cm above the tile minimum
  idx: Uint16Array;     // triangles; vertices are numbered in order of first use
  nv: number;
  expected: number;     // triangles by the formula
  dropped: number;      // expected - emitted (degenerate after cleaning or at 1 cm)
  tiny: number;         // of those, triangles of polygons under 100 cm2 (all but invisible)
}
export interface TileMesh { tile: number; buildings: number; min: number[]; size: number[]; levels: LevelMesh[] }

// One polygon: drop closing and repeated points, triangulate in the plane of
// the Newell normal, return the cleaned 3D points and earcut's triangles
// (orientation is fixed later, from the quantised positions).
function triangulate(rings: Float64Array[]): { pts: number[]; tris: number[]; normal: number[] } {
  // (normal: the exterior's Newell vector; its length is twice the area)
  const pts: number[] = [], holes: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    const g = rings[r], start = pts.length;
    let n = g.length / 3;
    if (n > 1 && g[0] === g[3 * n - 3] && g[1] === g[3 * n - 2] && g[2] === g[3 * n - 1]) n--;
    for (let i = 0; i < n; i++) {
      const k = pts.length;
      if (k > start && pts[k - 3] === g[3 * i] && pts[k - 2] === g[3 * i + 1] && pts[k - 1] === g[3 * i + 2]) continue;
      pts.push(g[3 * i], g[3 * i + 1], g[3 * i + 2]);
    }
    if (pts.length - start < 9) { pts.length = start; if (r === 0) return { pts: [], tris: [], normal: [0, 0, 0] }; continue; }
    if (r > 0) holes.push(start / 3);
  }
  const ne = holes.length ? holes[0] : pts.length / 3;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < ne; i++) {
    const a = 3 * i, b = 3 * ((i + 1) % ne);
    nx += (pts[a + 1] - pts[b + 1]) * (pts[a + 2] + pts[b + 2]);
    ny += (pts[a + 2] - pts[b + 2]) * (pts[a] + pts[b]);
    nz += (pts[a] - pts[b]) * (pts[a + 1] + pts[b + 1]);
  }
  const ax = Math.abs(nx) > Math.abs(ny) ? (Math.abs(nx) > Math.abs(nz) ? 0 : 2) : Math.abs(ny) > Math.abs(nz) ? 1 : 2;
  const u = (ax + 1) % 3, v = (ax + 2) % 3, flat = new Float64Array((pts.length / 3) * 2);
  for (let i = 0; i < pts.length / 3; i++) { flat[2 * i] = pts[3 * i + u]; flat[2 * i + 1] = pts[3 * i + v]; }
  return { pts, tris: earcut(flat, holes.length ? holes : null, 2), normal: [nx, ny, nz] };
}

// All buildings of one tile -> one quantised, welded mesh per level.
// Within a level, buildings go in Morton order of their centroids and
// polygons in file order; a vertex gets its number when first used, so the
// indices can be coded with Cesium quantized-mesh's high-water mark.
export function buildTile(tile: number, items: Placed[]): TileMesh {
  items = [...items].sort((a, b) => morton(a.x, a.y) - morton(b.x, b.y));
  const proj = (r: number[]): Float64Array => {
    const o = new Float64Array(r.length);
    for (let i = 0; i < r.length; i += 3) { o[i] = (r[i + 1] - LON0) * KX; o[i + 1] = (r[i] - LAT0) * KY; o[i + 2] = r[i + 2]; }
    return o;
  };
  const levels = [items.map((p) => level0(p.b).map((poly) => poly.map(proj))), items.map((p) => p.b.inst.map((poly) => poly.map(proj)))];
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const lv of levels) for (const bl of lv) for (const poly of bl) for (const r of poly) {
    for (let i = 0; i < r.length; i++) { const k = i % 3; if (r[i] < lo[k]) lo[k] = r[i]; if (r[i] > hi[k]) hi[k] = r[i]; }
  }
  const min = lo.map((v) => Math.floor(v * 100));
  const size = hi.map((v, k) => Math.round(v * 100) - min[k]);
  if (size.some((s) => !(s < 65000))) throw new Error(`tile ${tile}: extent ${size} cm does not fit u16`);
  const out: LevelMesh[] = levels.map((lv, li) => {
    const q: number[] = [], idx: number[] = [], seen = new Map<number, number>();
    let expected = 0, tiny = 0;
    const key = (x: number, y: number, z: number) => x + y * 65536 + z * 4294967296;
    const vert = (x: number, y: number, z: number): number => {
      const k = key(x, y, z);
      let i = seen.get(k);
      if (i === undefined) { i = q.length / 3; seen.set(k, i); q.push(x, y, z); }
      return i;
    };
    const at = (p: number[], i: number, k: number) => Math.round(p[3 * i + k] * 100) - min[k];
    for (const bl of lv) for (const poly of bl) {
      const want = expectedTriangles(poly), before = idx.length;
      expected += want;
      const { pts, tris, normal } = triangulate(poly);
      for (let t = 0; t < tris.length; t += 3) {
        const c = [tris[t], tris[t + 1], tris[t + 2]].map((i) => [at(pts, i, 0), at(pts, i, 1), at(pts, i, 2)]);
        const e1 = [c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]], e2 = [c[2][0] - c[0][0], c[2][1] - c[0][1], c[2][2] - c[0][2]];
        const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        if (cr[0] === 0 && cr[1] === 0 && cr[2] === 0) continue;             // zero area at 1 cm
        const flip = cr[0] * normal[0] + cr[1] * normal[1] + cr[2] * normal[2] < 0;
        const [a, b, d] = flip ? [c[0], c[2], c[1]] : c;
        idx.push(vert(a[0], a[1], a[2]), vert(b[0], b[1], b[2]), vert(d[0], d[1], d[2]));
      }
      if (Math.hypot(normal[0], normal[1], normal[2]) < 0.02) tiny += want - (idx.length - before) / 3;
    }
    // Points of dropped triangles still bound the tile: keep them after the
    // used vertices (no index points at them, so the high-water mark holds).
    for (const bl of lv) for (const poly of bl) for (const r of poly) {
      for (let i = 0; i < r.length; i += 3) vert(Math.round(r[i] * 100) - min[0], Math.round(r[i + 1] * 100) - min[1], Math.round(r[i + 2] * 100) - min[2]);
    }
    const nv = q.length / 3;
    if (nv > 65535) throw new Error(`tile ${tile} level ${li}: ${nv} vertices do not fit u16 indices`);
    return { q: Uint16Array.from(q), idx: Uint16Array.from(idx), nv, expected, dropped: expected - idx.length / 3, tiny };
  });
  return { tile, buildings: items.length, min, size, levels: out };
}

// Block payload before deflate: u32 nv, u32 ni, then x, y, z as zigzag
// deltas wrapped to 16 bits (planar), then the high-water-mark indices.
// Cesium quantized-mesh-1.0's layout; decoder in plb.ts (ortho-earth's
// packages/ortho-core/src/qmesh.ts decodeQuantizedMesh reads the same codes).
export function encodeBlock(m: LevelMesh): Uint8Array {
  const ni = m.idx.length, out = new Uint8Array(8 + 2 * (3 * m.nv + ni)), dv = new DataView(out.buffer);
  dv.setUint32(0, m.nv, true);
  dv.setUint32(4, ni, true);
  let p = 8;
  for (let k = 0; k < 3; k++) {
    for (let i = 0, prev = 0; i < m.nv; i++) {
      const d = ((m.q[3 * i + k] - prev) << 16) >> 16;
      dv.setUint16(p, ((d << 1) ^ (d >> 31)) & 0xffff, true); p += 2;
      prev = m.q[3 * i + k];
    }
  }
  for (let i = 0, hi = 0; i < ni; i++) {
    const c = hi - m.idx[i];
    if (c < 0) throw new Error('index out of first-use order');
    dv.setUint16(p, c, true); p += 2;
    if (c === 0) hi++;
  }
  return out;
}
