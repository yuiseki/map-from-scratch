// Bake side: a PLATEAU LOD1 solid becomes footprint rings in local metres,
// a height and an earcut roof (format.ts ships them; decode() extrudes).
import earcut from '../../../vendor/earcut/earcut.js';
import { bandOf, type Building } from './format.ts';
import type { Poly } from './gml.ts';

// Metres per degree at the centre latitude (WGS84 series), good to 0.1%
// over the 2.4 km the example covers.
export function toLocal(lat: number, lon: number, lat0: number, lon0: number): [number, number] {
  const p = (lat0 * Math.PI) / 180;
  const mLat = 111132.92 - 559.82 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p);
  const mLon = 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p);
  return [(lon - lon0) * mLon, (lat - lat0) * mLat];
}

export interface Footprint {
  rings: number[][][];   // polygons, each [outer, ...holes], each ring flat [x, y, ...] without the closing point
  height: number;        // top minus bottom of the lod1Solid, m
  cx: number; cy: number; // area-weighted centroid of the outer rings, m
}

const EPS_Z = 0.05;

export function footprints(lod1: Poly[], lat0: number, lon0: number): Footprint {
  let zmin = Infinity, zmax = -Infinity;
  for (const poly of lod1) for (const r of poly) for (let i = 2; i < r.length; i += 3) {
    zmin = Math.min(zmin, r[i]);
    zmax = Math.max(zmax, r[i]);
  }
  const rings: number[][][] = [];
  let a = 0, sx = 0, sy = 0;
  for (const poly of lod1) {
    // A footprint is a face lying at the bottom of the solid.
    if (!poly.every((r) => { for (let i = 2; i < r.length; i += 3) if (Math.abs(r[i] - zmin) > EPS_Z) return false; return true; })) continue;
    const out = poly.map((r) => {
      const flat: number[] = [];
      for (let i = 0; i + 2 < r.length; i += 3) {
        const [x, y] = toLocal(r[i], r[i + 1], lat0, lon0);
        const n = flat.length;
        if (n >= 2 && Math.abs(flat[n - 2] - x) < 1e-6 && Math.abs(flat[n - 1] - y) < 1e-6) continue;
        flat.push(x, y);
      }
      if (flat.length >= 4 && Math.abs(flat[0] - flat[flat.length - 2]) < 1e-6 && Math.abs(flat[1] - flat[flat.length - 1]) < 1e-6) flat.length -= 2;
      return flat;
    }).filter((r) => r.length >= 6);
    if (!out.length) continue;
    const o = out[0];
    for (let i = 0; i < o.length; i += 2) {
      const j = (i + 2) % o.length;
      const c = o[i] * o[j + 1] - o[j] * o[i + 1];
      a += c; sx += (o[i] + o[j]) * c; sy += (o[i + 1] + o[j + 1]) * c;
    }
    rings.push(out);
  }
  const cx = a ? sx / (3 * a) : 0, cy = a ? sy / (3 * a) : 0;
  return { rings, height: zmax - zmin, cx, cy };
}

// The footprint as format.ts ships it: rings, earcut roof triangles as
// corner indices of the polygon, the band of its centroid. Walls and top
// vertices are rebuilt by decode() at load.
export function toBuilding(f: Footprint, edges: ArrayLike<number>): Building {
  return {
    height: f.height,
    band: bandOf(f.cx, f.cy, edges),
    polys: f.rings.map((rings) => {
      const flat: number[] = [], holes: number[] = [];
      for (const r of rings) {
        if (flat.length) holes.push(flat.length / 2);
        flat.push(...r);
      }
      return { rings, roof: earcut(flat, holes.length ? holes : undefined, 2) };
    }),
  };
}
