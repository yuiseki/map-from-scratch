// Natural Earth land on the sphere. The bake triangulates in lon/lat with
// earcut; those triangles span up to tens of degrees and, drawn flat in 3D,
// cut through the globe (rendering-mistakes: "Flat triangles folding over the
// horizon", cesium 180 and 213). Here every edge longer than maxDeg is split
// at its midpoint at load time, the same edge always at the same point (a
// cache keyed by the edge), so neighbours share vertices and nothing cracks.
// At 1° the chord of an edge sags 0.24 km below the sphere; land is lifted
// by LAND_LIFT_KM so the ray-traced ocean (exact sphere) never shows through.

export const EARTH_R = 6371;           // km, sphere
export const LAND_LIFT_KM = 0.3;
export const LAND_MAX_EDGE_DEG = 1;

export function toEcef(lon: number, lat: number, h: number): [number, number, number] {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180, r = EARTH_R + h;
  return [r * Math.cos(p) * Math.cos(l), r * Math.cos(p) * Math.sin(l), r * Math.sin(p)];
}

export function subdivide(vertices: ArrayLike<number>, indices: ArrayLike<number>, maxDeg: number): { vertices: number[]; indices: number[] } {
  const v = Array.from(vertices), out: number[] = [];
  const mids = new Map<number, number>();
  const max2 = maxDeg * maxDeg;
  const len2 = (a: number, b: number) => (v[2 * a] - v[2 * b]) ** 2 + (v[2 * a + 1] - v[2 * b + 1]) ** 2;
  const mid = (a: number, b: number) => {
    const key = a < b ? a * 0x4000000 + b : b * 0x4000000 + a;
    let m = mids.get(key);
    if (m === undefined) {
      m = v.length / 2;
      v.push((v[2 * a] + v[2 * b]) / 2, (v[2 * a + 1] + v[2 * b + 1]) / 2);
      mids.set(key, m);
    }
    return m;
  };
  const stack: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    stack.push(indices[t], indices[t + 1], indices[t + 2]);
    while (stack.length) {
      const c = stack.pop()!, b = stack.pop()!, a = stack.pop()!;
      const ab = len2(a, b), bc = len2(b, c), ca = len2(c, a);
      const m = Math.max(ab, bc, ca);
      if (m <= max2) { out.push(a, b, c); continue; }
      // split the longest edge; winding is kept
      if (m === ab) { const x = mid(a, b); stack.push(a, x, c, x, b, c); }
      else if (m === bc) { const x = mid(b, c); stack.push(a, b, x, a, x, c); }
      else { const x = mid(c, a); stack.push(a, b, x, x, b, c); }
    }
  }
  return { vertices: v, indices: out };
}

// Positions relative to origin (km), Float32, for one draw call.
export function landMesh(layers: { vertices: ArrayLike<number>; indices: ArrayLike<number> }[], origin: number[]): { pos: Float32Array; idx: Uint32Array } {
  const pos: number[] = [], idx: number[] = [];
  for (const l of layers) {
    const s = subdivide(l.vertices, l.indices, LAND_MAX_EDGE_DEG), base = pos.length / 3;
    for (let i = 0; i < s.vertices.length; i += 2) {
      const p = toEcef(s.vertices[i], s.vertices[i + 1], LAND_LIFT_KM);
      pos.push(p[0] - origin[0], p[1] - origin[1], p[2] - origin[2]);
    }
    for (const i of s.indices) idx.push(base + i);
  }
  return { pos: new Float32Array(pos), idx: new Uint32Array(idx) };
}
