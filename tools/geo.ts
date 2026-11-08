// Geometry used at bake time. Nothing here ships to a renderer: the point of
// baking is that the renderer receives coordinates already projected,
// simplified and triangulated for exactly the map it draws.
import earcut from '../kits/earcut/earcut.ts';

export type Point = number[];          // [x, y, ...extra] — extra values ride along
export type Ring = Point[];
export type Box = [number, number, number, number];

const RAD = Math.PI / 180;

// Equal Earth (Šavrič, Patterson, Jenny 2018), unit sphere.
// x in [-2.7066, 2.7066], y in [-1.3174, 1.3174], north up.
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
export function equalEarth([lon, lat]: Point): [number, number] {
  const t = Math.asin(M * Math.sin(lat * RAD));
  const t2 = t * t, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = t * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
  return [x + 0, y + 0];
}

// Web Mercator in the unit square: x 0..1 west to east, y 0..1 north to south.
export function mercator([lon, lat]: Point): [number, number] {
  const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * RAD);
  return [lon / 360 + 0.5, 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)];
}

// Douglas–Peucker, iterative. tolerance 0 returns the input.
export function simplify<P extends Point>(pts: P[], tolerance: number): P[] {
  if (tolerance <= 0 || pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let best = -1, bestD = tol2;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      let d;
      if (len2 === 0) d = (px - ax) ** 2 + (py - ay) ** 2;
      else {
        const cross = dx * (py - ay) - dy * (px - ax);
        d = (cross * cross) / len2;
      }
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function openRing(ring: Ring): Ring {
  const n = ring.length;
  if (n > 1 && ring[0][0] === ring[n - 1][0] && ring[0][1] === ring[n - 1][1]) return ring.slice(0, -1);
  return ring;
}

// rings: [outer, ...holes] in any planar coordinates (closed or open).
export function triangulatePolygon(rings: Ring[]): { vertices: number[]; indices: number[] } {
  const vertices: number[] = [];
  const holes: number[] = [];
  for (const [i, ring] of rings.entries()) {
    if (i > 0) holes.push(vertices.length / 2);
    for (const [x, y] of openRing(ring)) vertices.push(x, y);
  }
  return { vertices, indices: earcut(vertices, holes) };
}

export function polygonsOf(geometry: { type: string; coordinates: unknown } | null | undefined): Ring[][] {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates as Ring[]];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates as Ring[][];
  return [];
}

// Clip a polyline to [minx, miny, maxx, maxy] (Liang–Barsky per segment).
// Returns the pieces that lie inside; a line that leaves and comes back
// becomes two pieces.
export function clipPolyline(pts: Point[], [x0, y0, x1, y1]: Box): Ring[] {
  const out: Ring[] = [];
  let cur: Ring | null = null;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
      if (p === 0) { if (q < 0) ok = false; continue; }
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
    }
    if (!ok || t0 > t1) { cur = null; continue; }
    const a = [ax + t0 * dx, ay + t0 * dy], b = [ax + t1 * dx, ay + t1 * dy];
    if (!cur || t0 > 0) { cur = [a]; out.push(cur); }
    cur.push(b);
    if (t1 < 1) cur = null;
  }
  return out;
}
