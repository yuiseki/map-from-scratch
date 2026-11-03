// dance.bin, the one file the page loads. It ships only what cannot be
// rebuilt (pattern "do not ship what can be rebuilt", example 02): the
// footprint corners, ring lengths and roof triangles. decode() rebuilds the
// top vertex of every corner and the two wall triangles of every edge, and
// returns the vertex and index arrays one draw call uses.
//
//   header (88 B)  "DNC2", u32 buildings B, polygons P, rings R, corners N, roof indices T,
//                  f32 x 16 ring edges (m from the centre, the outer edge of each band)
//   u16[B] height (0.1 m)   u16[R] ring length   u16[P] roof triangles
//   i16[N] dx, i16[N] dy    corners, 0.1 m, each the difference from the previous corner (mod 2^16)
//   u16[T] roof             corner index within the polygon (outer ring, then holes)
//   u8[B] band   u8[B] polygons of the building   u8[P] rings of the polygon
//
// Decoded vertex (8 B): i16 x, i16 y (0.1 m, east and north of Tokyo Station),
// u16 height (0.1 m, the building's), u8 band, u8 top (0 ground, 1 roof).
// The vertex carries no z: the shader puts a top vertex at
// height * (1 + GAIN * level[band]), so the dance needs no upload.

export const MAGIC = 'DNC2';
export const HEADER_BYTES = 24 + 4 * 16;
export const VERTEX_BYTES = 8;
export const UNIT_M = 0.1;
// 16 bands, the analyser bins of the original (fftSize 32).
export const BANDS = 16;

// The band of a building: rings outward from the centre, so a beat in the
// low bins lifts the middle and the high bins the rim. The ring edges are
// the distance quantiles of the buildings (ringEdges), so every band holds
// the same number of buildings: rings of equal width left 10 buildings in
// the bass band and 4,690 in the last (bake, 13,051 buildings).
export function bandOf(x: number, y: number, edges: ArrayLike<number>): number {
  const d = Math.hypot(x, y);
  for (let i = 0; i < BANDS - 1; i++) if (d < edges[i]) return i;
  return BANDS - 1;
}

// edges[i] = distance below which the first (i + 1) / BANDS of the buildings lie.
export function ringEdges(distances: number[]): number[] {
  const s = [...distances].sort((a, b) => a - b), n = s.length;
  return Array.from({ length: BANDS }, (_, i) => (i === BANDS - 1 ? s[n - 1] : s[Math.ceil(((i + 1) * n) / BANDS)] ?? s[n - 1]));
}

// A footprint polygon in metres: rings flat [x, y, ...] without the closing
// point (outer first), and its roof triangles as corner indices.
export interface Poly { rings: number[][]; roof: number[] }
export interface Building { height: number; band: number; polys: Poly[] }

const q16 = (v: number, lo: number, hi: number): number => {
  const r = Math.round(v / UNIT_M);
  if (r < lo || r > hi) throw new Error(`${v} m does not fit 16 bits at ${UNIT_M} m`);
  return r;
};
const pad2 = (n: number) => n + (n & 1);

export function encode(edges: number[], buildings: Building[]): ArrayBuffer {
  const polys = buildings.flatMap((b) => b.polys), rings = polys.flatMap((p) => p.rings);
  const B = buildings.length, P = polys.length, R = rings.length;
  const N = rings.reduce((s, r) => s + r.length / 2, 0), T = polys.reduce((s, p) => s + p.roof.length, 0);
  const u16 = B + R + P + 2 * N + T;
  const buf = new ArrayBuffer(HEADER_BYTES + 2 * u16 + pad2(2 * B + P));
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
  [B, P, R, N, T].forEach((v, i) => dv.setUint32(4 + 4 * i, v, true));
  for (let i = 0; i < BANDS; i++) dv.setFloat32(24 + 4 * i, edges[i] ?? 0, true);
  let o = HEADER_BYTES;
  const w16 = (v: number) => { dv.setUint16(o, v & 0xffff, true); o += 2; };
  for (const b of buildings) w16(q16(b.height, 0, 65535));
  for (const r of rings) w16(r.length / 2);
  for (const p of polys) w16(p.roof.length / 3);
  // Planar and delta-coded: all dx, then all dy.
  for (const k of [0, 1]) {
    let prev = 0;
    for (const r of rings) for (let i = k; i < r.length; i += 2) {
      const v = q16(r[i], -32768, 32767);
      w16(v - prev);
      prev = v;
    }
  }
  for (const p of polys) for (const k of p.roof) w16(k);
  for (const b of buildings) { dv.setUint8(o++, b.band); }
  for (const b of buildings) {
    if (b.polys.length > 255) throw new Error(`${b.polys.length} polygons in one building`);
    dv.setUint8(o++, b.polys.length);
  }
  for (const p of polys) {
    if (p.rings.length > 255) throw new Error(`${p.rings.length} rings in one polygon`);
    dv.setUint8(o++, p.rings.length);
  }
  return buf;
}

export interface Decoded { vertexCount: number; buildings: number; edges: Float32Array; vertices: Uint8Array; indices: Uint32Array }

export function decode(buf: ArrayBuffer): Decoded {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error(`dance.bin: magic ${magic}`);
  const [B, P, R, N, T] = [0, 1, 2, 3, 4].map((i) => dv.getUint32(4 + 4 * i, true));
  let o = HEADER_BYTES;
  const take16 = (n: number) => { const a = new Uint16Array(buf, o, n); o += 2 * n; return a; };
  const height = take16(B), ringLen = take16(R), roofTris = take16(P);
  const dx = new Int16Array(buf, o, N); o += 2 * N;
  const dy = new Int16Array(buf, o, N); o += 2 * N;
  const roof = take16(T);
  const band = new Uint8Array(buf, o, B), polysOf = new Uint8Array(buf, o + B, B), ringsOf = new Uint8Array(buf, o + 2 * B, P);

  let walls = 0;
  for (let r = 0; r < R; r++) walls += ringLen[r] * 6;
  const verts = new Uint8Array(2 * N * VERTEX_BYTES), out = new DataView(verts.buffer);
  const idx = new Uint32Array(walls + T);
  let v = 0, ii = 0, p = 0, r = 0, c = 0, t = 0, x = 0, y = 0;
  for (let b = 0; b < B; b++) {
    for (let pe = p + polysOf[b]; p < pe; p++) {
      const base = v, r0 = r;
      let m = 0;
      for (let re = r + ringsOf[p]; r < re; r++) m += ringLen[r];
      for (let k = 0; k < m; k++, c++) {
        x = (x + dx[c]) << 16 >> 16;
        y = (y + dy[c]) << 16 >> 16;
        for (const top of [0, 1]) {
          const at = (base + k + top * m) * VERTEX_BYTES;
          out.setInt16(at, x, true);
          out.setInt16(at + 2, y, true);
          out.setUint16(at + 4, height[b], true);
          out.setUint8(at + 6, band[b]);
          out.setUint8(at + 7, top);
        }
      }
      // Walls: every edge of every ring, outer and holes.
      let start = base;
      for (let k = r0; k < r; k++) {
        const n = ringLen[k];
        for (let i = 0; i < n; i++) {
          const b0 = start + i, b1 = start + ((i + 1) % n);
          idx[ii++] = b0; idx[ii++] = b1; idx[ii++] = b1 + m;
          idx[ii++] = b0; idx[ii++] = b1 + m; idx[ii++] = b0 + m;
        }
        start += n;
      }
      for (let k = 0, ke = roofTris[p] * 3; k < ke; k++) idx[ii++] = base + m + roof[t++];
      v += 2 * m;
    }
  }
  return { vertexCount: v, buildings: B, edges: new Float32Array(buf.slice(24, HEADER_BYTES)), vertices: verts, indices: idx };
}
