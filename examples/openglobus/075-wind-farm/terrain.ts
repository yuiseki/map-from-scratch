// Terrain grid of the wind farm area, baked by bake.ts from Mapterhorn.
//
// terrain.bin, little endian:
//   0 magic u32 'MFWT', 4 w u16, 6 h u16, 8 cell f32 (m), 12 x0 f32, 16 y0 f32
//   (local metres of the south-west vertex), 20 reserved u32, 24 lon0 f64,
//   32 lat0 f64 (origin of the local metres), 40.. w*h u16 heights in
//   QUANTUM metres, rows from south to north. The sea is 0 m (Mapterhorn
//   has no bathymetry) and negative heights are clamped to it.
//
// The renderer draws the grid with gridIndices, and heightAt returns the
// height of that drawn surface, so a tower base placed with it touches the
// mesh exactly (terrain.test.ts).

export const MAGIC = 0x5457464d; // 'MFWT'
export const HEADER_BYTES = 40;
export const QUANTUM = 0.25;
export const EARTH_RADIUS = 6371008.8;

export interface TerrainMeta { w: number; h: number; cell: number; x0: number; y0: number; lon0: number; lat0: number }
export interface Terrain extends TerrainMeta { raw: Uint16Array }

// Local equirectangular metres around (lon0, lat0): x east, y north. Over the
// 32 x 43 km area the scale error against a true tangent plane stays under
// 0.1 %, far below the 80 m grid cell.
export function toLocal(lon: number, lat: number, lon0: number, lat0: number): [number, number] {
  const k = (Math.PI / 180) * EARTH_RADIUS;
  return [(lon - lon0) * k * Math.cos((lat0 * Math.PI) / 180), (lat - lat0) * k];
}

export function encodeTerrain(m: TerrainMeta, metres: ArrayLike<number>): Uint8Array {
  if (metres.length !== m.w * m.h) throw new RangeError(`expected ${m.w * m.h} heights, got ${metres.length}`);
  const out = new Uint8Array(HEADER_BYTES + 2 * m.w * m.h);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint16(4, m.w, true);
  dv.setUint16(6, m.h, true);
  dv.setFloat32(8, m.cell, true);
  dv.setFloat32(12, m.x0, true);
  dv.setFloat32(16, m.y0, true);
  dv.setFloat64(24, m.lon0, true);
  dv.setFloat64(32, m.lat0, true);
  for (let i = 0; i < metres.length; i++) {
    dv.setUint16(HEADER_BYTES + 2 * i, Math.min(65535, Math.max(0, Math.round(metres[i] / QUANTUM))), true);
  }
  return out;
}

export function decodeTerrain(buf: ArrayBuffer): Terrain {
  const dv = new DataView(buf);
  if (buf.byteLength < HEADER_BYTES || dv.getUint32(0, true) !== MAGIC) throw new Error('terrain.bin: bad magic');
  const w = dv.getUint16(4, true), h = dv.getUint16(6, true);
  if (buf.byteLength !== HEADER_BYTES + 2 * w * h) throw new Error(`terrain.bin: ${buf.byteLength} bytes for ${w}x${h}`);
  return {
    w, h,
    cell: dv.getFloat32(8, true), x0: dv.getFloat32(12, true), y0: dv.getFloat32(16, true),
    lon0: dv.getFloat64(24, true), lat0: dv.getFloat64(32, true),
    raw: new Uint16Array(buf, HEADER_BYTES, w * h),
  };
}

// Two triangles per cell, a b d and a d c with a south-west, b south-east,
// c north-west, d north-east: counter-clockwise seen from above.
export function gridIndices(w: number, h: number): Uint32Array {
  const idx = new Uint32Array((w - 1) * (h - 1) * 6);
  let k = 0;
  for (let j = 0; j < h - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
    idx[k++] = a; idx[k++] = b; idx[k++] = d;
    idx[k++] = a; idx[k++] = d; idx[k++] = c;
  }
  return idx;
}

// Height of the drawn surface at local metres (x, y), clamped to the grid.
export function heightAt(t: Terrain, x: number, y: number): number {
  const gx = Math.min(t.w - 1, Math.max(0, (x - t.x0) / t.cell));
  const gy = Math.min(t.h - 1, Math.max(0, (y - t.y0) / t.cell));
  const i = Math.min(t.w - 2, Math.floor(gx)), j = Math.min(t.h - 2, Math.floor(gy));
  const fx = gx - i, fy = gy - j;
  const at = (ii: number, jj: number) => t.raw[jj * t.w + ii] * QUANTUM;
  const ha = at(i, j), hb = at(i + 1, j), hc = at(i, j + 1), hd = at(i + 1, j + 1);
  return fx >= fy ? ha + fx * (hb - ha) + fy * (hd - hb) : ha + fy * (hc - ha) + fx * (hd - hc);
}
