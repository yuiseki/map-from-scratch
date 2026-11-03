// dance.bin, the one file the page loads: every building as an extruded
// LOD1 footprint, ready for one indexed draw call.
//
//   header (80 B)  "DNC1", u32 vertices, u32 indices, u32 buildings,
//                  f32 x 16 ring edges (m from the centre, the outer edge of each band)
//   vertices       8 B each: i16 x, i16 y (east, north of Tokyo Station, 0.1 m),
//                  u16 height (0.1 m, the building's, on every vertex of it),
//                  u8 band, u8 top (0 = on the ground, 1 = at the roof)
//   indices        u32, triangles (walls, then roofs, building by building)
//
// The vertex does not carry its z: the shader puts a top vertex at
// height * (1 + GAIN * level[band]), so the dance needs no upload.

export const MAGIC = 'DNC1';
export const HEADER_BYTES = 16 + 4 * 16;
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

export interface Vertex { x: number; y: number; h: number; band: number; top: number }

export function encode(m: { edges: number[]; buildings: number; verts: Vertex[]; indices: number[] }): ArrayBuffer {
  const nv = m.verts.length, ni = m.indices.length;
  const buf = new ArrayBuffer(HEADER_BYTES + nv * VERTEX_BYTES + ni * 4);
  const dv = new DataView(buf);
  for (let i = 0; i < 4; i++) dv.setUint8(i, MAGIC.charCodeAt(i));
  dv.setUint32(4, nv, true);
  dv.setUint32(8, ni, true);
  dv.setUint32(12, m.buildings, true);
  for (let i = 0; i < BANDS; i++) dv.setFloat32(16 + 4 * i, m.edges[i] ?? 0, true);
  const q = (v: number, lo: number, hi: number): number => {
    const r = Math.round(v / UNIT_M);
    if (r < lo || r > hi) throw new Error(`${v} m does not fit 16 bits at ${UNIT_M} m`);
    return r;
  };
  m.verts.forEach((v, i) => {
    const o = HEADER_BYTES + i * VERTEX_BYTES;
    dv.setInt16(o, q(v.x, -32768, 32767), true);
    dv.setInt16(o + 2, q(v.y, -32768, 32767), true);
    dv.setUint16(o + 4, q(v.h, 0, 65535), true);
    dv.setUint8(o + 6, v.band);
    dv.setUint8(o + 7, v.top);
  });
  const io = HEADER_BYTES + nv * VERTEX_BYTES;
  m.indices.forEach((k, i) => dv.setUint32(io + i * 4, k, true));
  return buf;
}

export interface Decoded { vertexCount: number; buildings: number; edges: Float32Array; vertices: Uint8Array; indices: Uint32Array }

export function decode(buf: ArrayBuffer): Decoded {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error(`dance.bin: magic ${magic}`);
  const nv = dv.getUint32(4, true), ni = dv.getUint32(8, true);
  const io = HEADER_BYTES + nv * VERTEX_BYTES;
  return {
    vertexCount: nv,
    buildings: dv.getUint32(12, true),
    edges: new Float32Array(buf.slice(16, HEADER_BYTES)),
    vertices: new Uint8Array(buf, HEADER_BYTES, nv * VERTEX_BYTES),
    indices: new Uint32Array(buf, io, ni),
  };
}
