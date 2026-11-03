// The baked elevation grid (fuji.mftl, served gzip-compressed and inflated
// with DecompressionStream) and what the renderer derives from it at load.
//
//   header, 32 B little endian:
//     0 "MFTL", 4 version u16 = 1, 6 w u16, 8 h u16, 10 z u8 (Web Mercator
//     zoom of one texel = one source pixel), 12 x0 u32, 16 y0 u32 (global
//     pixel of the grid's top-left corner at zoom z), 20 q f32 (metres per
//     height step), 24 cell f64 (ground metres per texel at the centre)
//   residuals: w*h int16, row-major from the north-west. Planar predictor
//     left + up - upleft (first row: left, first column: up); the quantised
//     height is predictor + residual, in steps of q.
//   water: w*h bytes, 1 where OpenStreetMap maps a lake or reservoir.
export const HEADER_BYTES = 32;

export interface GridMeta { w: number; h: number; z: number; x0: number; y0: number; q: number; cell: number }
export interface Grid extends GridMeta { heights: Float32Array; water: Uint8Array }

const predict = (v: Int32Array, w: number, x: number, y: number): number => {
  const i = y * w + x;
  if (y === 0) return x === 0 ? 0 : v[i - 1];
  if (x === 0) return v[i - w];
  return v[i - 1] + v[i - w] - v[i - w - 1];
};

export function encodeGrid(g: GridMeta & { qh: Int32Array; water: Uint8Array }): Uint8Array {
  const { w, h } = g, n = w * h;
  const out = new Uint8Array(HEADER_BYTES + 2 * n + n);
  const dv = new DataView(out.buffer);
  out.set([77, 70, 84, 76]);
  dv.setUint16(4, 1, true); dv.setUint16(6, w, true); dv.setUint16(8, h, true); out[10] = g.z;
  dv.setUint32(12, g.x0, true); dv.setUint32(16, g.y0, true); dv.setFloat32(20, g.q, true); dv.setFloat64(24, g.cell, true);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = g.qh[y * w + x] - predict(g.qh, w, x, y);
    if (r < -32768 || r > 32767) throw new Error(`residual ${r} at ${x},${y} does not fit int16`);
    dv.setInt16(HEADER_BYTES + 2 * (y * w + x), r, true);
  }
  out.set(g.water, HEADER_BYTES + 2 * n);
  return out;
}

export function decodeGrid(bytes: Uint8Array): Grid {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'MFTL') throw new Error('not an MFTL grid');
  const w = dv.getUint16(6, true), h = dv.getUint16(8, true), n = w * h, q = dv.getFloat32(20, true);
  const v = new Int32Array(n), heights = new Float32Array(n);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    v[i] = predict(v, w, x, y) + dv.getInt16(HEADER_BYTES + 2 * i, true);
    heights[i] = v[i] * q;
  }
  return {
    w, h, z: bytes[10], x0: dv.getUint32(12, true), y0: dv.getUint32(16, true), q, cell: dv.getFloat64(24, true),
    heights, water: bytes.slice(HEADER_BYTES + 2 * n, HEADER_BYTES + 3 * n),
  };
}

// Per texel: [dh/dx east, dh/dy north, water, 1], central differences
// (one-sided at the border). The fragment shader turns this into the normal
// normalize(-gx*e, -gy*e, 1) for exaggeration e, so the slider needs no
// rebuild. Rows run north to south, hence the sign of gy.
export function gradients(hgt: Float32Array, water: Uint8Array, w: number, h: number, cell: number): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const xl = Math.max(0, x - 1), xr = Math.min(w - 1, x + 1), yn = Math.max(0, y - 1), ys = Math.min(h - 1, y + 1);
    const i = y * w + x;
    out[i * 4] = (hgt[y * w + xr] - hgt[y * w + xl]) / ((xr - xl) * cell);
    out[i * 4 + 1] = (hgt[yn * w + x] - hgt[ys * w + x]) / ((ys - yn) * cell);
    out[i * 4 + 2] = water[i];
    out[i * 4 + 3] = 1;
  }
  return out;
}

// The mesh samples every step-th texel; the last row and column are clamped
// to the grid's last texel so the surface reaches the edge.
export const meshSize = (w: number, h: number, step: number) =>
  ({ nx: Math.ceil((w - 1) / step) + 1, ny: Math.ceil((h - 1) / step) + 1 });

// Two triangles per quad of an nx x ny vertex grid (vertex id = row*nx+col;
// the vertex shader rebuilds positions from gl_VertexID).
export function gridIndices(nx: number, ny: number): Uint32Array {
  const out = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let k = 0;
  for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
    const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
    out[k++] = a; out[k++] = d; out[k++] = b;
    out[k++] = b; out[k++] = d; out[k++] = e;
  }
  return out;
}

// Continuous texel coordinates (0 = the grid's west / north edge).
export function lonLatToTexel(lon: number, lat: number, g: Pick<GridMeta, 'z' | 'x0' | 'y0'>): { i: number; j: number } {
  const world = 512 * 2 ** g.z, s = Math.sin((lat * Math.PI) / 180);
  return {
    i: ((lon + 180) / 360) * world - g.x0,
    j: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * world - g.y0,
  };
}

// Local metres: x east, y north, origin at the grid centre. One cell size is
// used for the whole grid; Mercator scale changes by 0.3% over its 0.29°.
export const texelToLocal = (i: number, j: number, g: Pick<GridMeta, 'w' | 'h' | 'cell'>) =>
  ({ x: (i - g.w / 2) * g.cell, y: (g.h / 2 - j) * g.cell });
