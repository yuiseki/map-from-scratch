// Bake-time: cut country polygons into lon/lat grid cells before
// triangulating, so every lid triangle is at most one cell across. A lid is
// drawn flat between its three corners at radius 1 + h; earcut's long
// triangles across Russia or Canada would cut through the sphere, while a
// 3 degree cell sags at most 1 - cos(2.1 deg) = 0.00067 of the radius, below
// the smallest extrusion (ramp.ts H_MIN). Cesium 213 split its land
// triangles at load for the same reason (rendering-mistakes.md, "Flat
// triangles folding over the horizon").
//
// Units are integers (0.01 degree). densifyRing inserts a vertex wherever a
// ring edge crosses a grid line, so clipping a ring to a cell never has to
// invent a vertex: neighbouring cells share exactly the same boundary
// vertices (no cracks), and the walls built from the densified rings meet
// the lid edges vertex for vertex.
import { triangulatePolygon } from '../../../tools/geo.ts';

export type P = number[];

export function densifyRing(ring: P[], step: number): P[] {
  const out: P[] = [];
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    out.push(a);
    const ts: number[] = [];
    for (const k of [0, 1]) {
      const lo = Math.min(a[k], b[k]), hi = Math.max(a[k], b[k]);
      for (let g = Math.floor(lo / step + 1) * step; g < hi; g += step) ts.push((g - a[k]) / (b[k] - a[k]));
    }
    ts.sort((x, y) => x - y);
    for (const t of ts) {
      const p = [Math.round(a[0] + t * (b[0] - a[0])), Math.round(a[1] + t * (b[1] - a[1]))];
      const last = out[out.length - 1];
      if (p[0] !== last[0] || p[1] !== last[1]) out.push(p);
    }
  }
  return out;
}

export function ringArea(r: P[]): number {
  let s = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return s / 2;
}

// Sutherland–Hodgman against the four sides of [x0, x1] x [y0, y1].
export function clipRing(ring: P[], x0: number, y0: number, x1: number, y1: number): P[] {
  let pts = ring;
  const sides: [number, number, number][] = [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]];
  for (const [k, v, s] of sides) {
    if (!pts.length) break;
    const inside = (p: P) => (p[k] - v) * s >= 0;
    const out: P[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const ia = inside(a), ib = inside(b);
      if (ia) out.push(a);
      if (ia !== ib) {
        const t = (v - a[k]) / (b[k] - a[k]);
        const p = k === 0 ? [v, Math.round(a[1] + t * (b[1] - a[1]))] : [Math.round(a[0] + t * (b[0] - a[0])), v];
        if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
      }
    }
    pts = out;
  }
  return Math.abs(ringArea(pts)) > 0 ? pts : [];
}

export interface Piece { cx: number; cy: number; rings: P[][] }

// rings: [outer, ...holes], already densified with the same step.
export function cellPieces(rings: P[][], step: number): Piece[] {
  const outer = rings[0];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of outer) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
  const pieces: Piece[] = [];
  for (let cx = Math.floor(minx / step); cx * step < maxx; cx++) {
    for (let cy = Math.floor(miny / step); cy * step < maxy; cy++) {
      const x0 = cx * step, y0 = cy * step, x1 = x0 + step, y1 = y0 + step;
      const o = clipRing(outer, x0, y0, x1, y1);
      if (!o.length) continue;
      const holes = rings.slice(1).map((h) => clipRing(h, x0, y0, x1, y1)).filter((h) => h.length);
      pieces.push({ cx, cy, rings: [o, ...holes] });
    }
  }
  return pieces;
}

export function triangulateCells(rings: P[][], step: number): { vertices: number[]; indices: number[] } {
  const vertices: number[] = [], indices: number[] = [];
  for (const piece of cellPieces(rings, step)) {
    const t = triangulatePolygon(piece.rings);
    const base = vertices.length / 2;
    vertices.push(...t.vertices);
    for (const i of t.indices) indices.push(base + i);
  }
  return { vertices, indices };
}
