// Bake side: land/water coverage on an equirectangular grid, by even-odd
// scanline fill at ss x ss samples per cell, then averaged to 0..255. The
// globe's fragment shader samples it with bilinear filtering and a
// smoothstep, so the coast stays smooth when the camera is low.
export interface Grid { w: number; h: number; lon0: number; lat0: number; dlon: number; dlat: number }   // lat0 is the north edge

export class Mask {
  g: Grid; ss: number; bits: Uint8Array;
  constructor(g: Grid, ss: number) { this.g = g; this.ss = ss; this.bits = new Uint8Array(g.w * ss * g.h * ss); }

  // rings: [lon, lat][] (any closure); value 1 = land, 0 = water.
  fill(rings: number[][][], value: 0 | 1): void {
    const { g, ss } = this, W = g.w * ss, H = g.h * ss;
    const sx = (lon: number) => (lon - g.lon0) / g.dlon * ss, sy = (lat: number) => (g.lat0 - lat) / g.dlat * ss;
    const edges: number[] = [];   // x0, y0, x1, y1 in sample units
    let ymin = Infinity, ymax = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      const e = [sx(a[0]), sy(a[1]), sx(b[0]), sy(b[1])];
      if (e[1] === e[3]) continue;
      edges.push(...e);
      ymin = Math.min(ymin, e[1], e[3]); ymax = Math.max(ymax, e[1], e[3]);
    }
    const r0 = Math.max(0, Math.floor(ymin)), r1 = Math.min(H - 1, Math.ceil(ymax));
    const xs: number[] = [];
    for (let row = r0; row <= r1; row++) {
      const y = row + 0.5;
      xs.length = 0;
      for (let k = 0; k < edges.length; k += 4) {
        const y0 = edges[k + 1], y1 = edges[k + 3];
        if ((y0 <= y) !== (y1 <= y)) xs.push(edges[k] + (y - y0) / (y1 - y0) * (edges[k + 2] - edges[k]));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - 0.5)), c1 = Math.min(W - 1, Math.ceil(xs[k + 1] - 0.5) - 1);
        if (c1 >= c0) this.bits.fill(value, row * W + c0, row * W + c1 + 1);
      }
    }
  }

  coverage(): Uint8Array {
    const { g, ss } = this, W = g.w * ss, out = new Uint8Array(g.w * g.h), n = ss * ss;
    for (let r = 0; r < g.h; r++) for (let c = 0; c < g.w; c++) {
      let s = 0;
      for (let y = 0; y < ss; y++) for (let x = 0; x < ss; x++) s += this.bits[(r * ss + y) * W + c * ss + x];
      out[r * g.w + c] = Math.round(s * 255 / n);
    }
    return out;
  }
}
