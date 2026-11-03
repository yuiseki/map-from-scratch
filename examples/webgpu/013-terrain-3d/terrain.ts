// Terrain .terr format decoding, Rice codec and mesh math.

export const CS = 128;   // cells per chunk side
export const S = CS + 3; // 131 samples per chunk side (with 1 border sample on each side)
export const LEVELS = 4;
export const N0 = 3072;
export const HEADER_BYTES = 64;
export const ENTRY_BYTES = 8;

export interface TerrHeader {
  version: number;
  cs: number;
  levels: number;
  chunkCount: number;
  x0: number;
  y0: number;
  cellSpacing: number;
  lat0: number;
  lon0: number;
}

export function parseTerrHeader(u8: Uint8Array): TerrHeader {
  if (u8.byteLength < HEADER_BYTES) throw new Error('.terr header too short');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'MFST') throw new Error('not a .terr file');
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error(`unsupported .terr version: ${version}`);

  return {
    version,
    cs: dv.getUint16(6, true),
    levels: u8[9],
    chunkCount: dv.getUint16(10, true),
    x0: dv.getUint32(12, true),
    y0: dv.getUint32(16, true),
    cellSpacing: dv.getFloat64(24, true),
    lat0: dv.getFloat64(32, true),
    lon0: dv.getFloat64(40, true),
  };
}

export function morton(i: number, j: number): number {
  let m = 0;
  for (let b = 0; b < 8; b++) m |= (((j >> b) & 1) << (2 * b)) | (((i >> b) & 1) << (2 * b + 1));
  return m;
}

// Return (row, col) coordinates of L3 (3x3) chunks in file (Morton) order
export function getL3ChunkOrder(): [number, number][] {
  const cells: [number, number, number][] = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      cells.push([morton(i, j), i, j]);
    }
  }
  cells.sort((a, b) => a[0] - b[0]);
  return cells.map(([, i, j]) => [i, j]);
}

const predict = (o: ArrayLike<number>, r: number, c: number, base: number): number => {
  const t = r * S + c;
  return r && c ? o[t - 1] + o[t - S] - o[t - S - 1] : r ? o[t - S] : c ? o[t - 1] : base;
};

export function encodeChunk(q: ArrayLike<number>, block = 32): Uint8Array {
  const n = S * S;
  const z = new Uint32Array(n);
  for (let r = 0, t = 0; r < S; r++) {
    for (let c = 0; c < S; c++, t++) {
      const d = q[t] - predict(q, r, c, q[0]);
      z[t] = d >= 0 ? 2 * d : -2 * d - 1;
    }
  }
  const out = new Uint8Array(2 + n * 8);
  out[0] = q[0] & 255;
  out[1] = q[0] >> 8;
  let pos = 16;
  const put = (v: number, bits: number) => {
    for (let b = bits - 1; b >= 0; b--, pos++) {
      if ((v >> b) & 1) out[pos >> 3] |= 0x80 >> (pos & 7);
    }
  };
  for (let s = 0; s < n; s += block) {
    const e = Math.min(n, s + block);
    let best = 0, cost = Infinity;
    for (let k = 0; k < 15; k++) {
      let c = 0;
      for (let t = s; t < e; t++) c += (z[t] >>> k) + 1 + k;
      if (c < cost) { cost = c; best = k; }
    }
    put(best, 4);
    for (let t = s; t < e; t++) {
      pos += z[t] >>> best;
      out[pos >> 3] |= 0x80 >> (pos & 7);
      pos++;
      put(z[t] & ((1 << best) - 1), best);
    }
  }
  return out.slice(0, (pos + 7) >> 3);
}

export function decodeChunk(src: Uint8Array, out: Uint16Array, block = 32): void {
  const base = src[0] | (src[1] << 8);
  let p = 2, win = 0, avail = 0, k = 0;
  for (let r = 0, t = 0; r < S; r++) {
    for (let c = 0; c < S; c++, t++) {
      while (avail <= 24 && p < src.length) {
        win |= (src[p++] | 0) << (24 - avail);
        avail += 8;
      }
      if (t % block === 0) {
        k = win >>> 28;
        win <<= 4;
        avail -= 4;
      }
      let u = 0;
      while (win === 0) {
        u += avail;
        avail = 0;
        while (avail <= 24 && p < src.length) {
          win |= (src[p++] | 0) << (24 - avail);
          avail += 8;
        }
        if (win === 0 && p >= src.length) break;
      }
      const lz = Math.clz32(win);
      u += lz;
      win = lz === 31 ? 0 : win << (lz + 1);
      avail -= lz + 1;
      while (avail <= 24 && p < src.length) {
        win |= (src[p++] | 0) << (24 - avail);
        avail += 8;
      }
      let zz = u << k;
      if (k) {
        zz |= win >>> (32 - k);
        win <<= k;
        avail -= k;
      }
      out[t] = predict(out, r, c, base) + ((zz >>> 1) ^ -(zz & 1));
    }
  }
}

export function elevationColor(h: number): [number, number, number, number] {
  // Fuji elevation palette matching 17-fuji-terrain-3d:
  // < 700m: lowland rich forest green
  // 700 - 1500m: subalpine forest
  // 1500 - 2500m: volcanic scoria / reddish brown
  // 2500 - 3300m: dark mountain basalt rock
  // > 3300m: snow white summit
  if (h < 700) {
    const t = Math.max(0, h) / 700;
    return [0.28 + 0.05 * t, 0.42 + 0.06 * t, 0.23 + 0.04 * t, 1.0];
  } else if (h < 1500) {
    const t = (h - 700) / 800;
    return [0.33 + 0.14 * t, 0.48 + 0.03 * t, 0.27 + 0.04 * t, 1.0];
  } else if (h < 2500) {
    const t = (h - 1500) / 1000;
    return [0.47 + 0.06 * t, 0.51 - 0.07 * t, 0.31 + 0.03 * t, 1.0];
  } else if (h < 3300) {
    const t = (h - 2500) / 800;
    return [0.53 - 0.08 * t, 0.44 - 0.05 * t, 0.34 + 0.04 * t, 1.0];
  } else {
    const t = Math.min(1.0, (h - 3300) / 476);
    return [0.45 + 0.55 * t, 0.39 + 0.61 * t, 0.38 + 0.62 * t, 1.0];
  }
}

export function generateGridIndices(cols: number, rows: number): Uint32Array {
  const indices = new Uint32Array(cols * rows * 6);
  let ptr = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = (r + 1) * (cols + 1) + c;
      const i3 = i2 + 1;
      // Triangle 1
      indices[ptr++] = i0;
      indices[ptr++] = i2;
      indices[ptr++] = i1;
      // Triangle 2
      indices[ptr++] = i1;
      indices[ptr++] = i2;
      indices[ptr++] = i3;
    }
  }
  return indices;
}
