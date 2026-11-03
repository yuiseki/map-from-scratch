// Sweeping a 2D cross-section along a polyline in 3D, as Cesium's
// PolylineVolumeGeometry does (packages/core/Source/PolylineVolumeGeometryLibrary.js,
// Apache-2.0): one ring of the shape per vertex, bands of triangles between
// rings, a cap at each end.
//
// Differences from Cesium, and why:
// - Frame. Cesium orients each ring by the ellipsoid's surface normal at the
//   vertex (computeRotationAngle / eastNorthUpToFixedFrame). Here the frame is
//   carried along the line by parallel transport: at every corner the up
//   vector is turned by the smallest rotation that takes the incoming
//   tangent to the outgoing one (a discrete rotation-minimising frame,
//   the limit of Wang et al.'s double reflection for a polyline). It cannot
//   flip at an inflection, as a Frenet frame does. On a sphere every
//   direction is a principal direction, so the geodesic torsion is zero and
//   the RMF seeded with the radial stays radial: a box sits upright on the
//   ground the whole way (sweep.test.ts measures < 1°).
// - Corners. Mitre: one ring in the bisector plane, each point pushed along
//   the incoming tangent onto that plane (stretched by 1 / cos(θ/2) across
//   the bend). Beyond mitreLimit (the stretch factor) the corner is rounded
//   instead of bevelled: Cesium's BEVELED fills the outside with a flat cut,
//   which needs a second outline; a fan of rings about the corner vertex
//   needs nothing new and has no gap and no spike. Round: rings turned in
//   steps of at most roundStepDeg about the vertex (MapLibre's round join
//   uses 20° per triangle). Corners under one step get the mitre ring in
//   either mode (stretch at most 1 / cos(7.5°) = 1.009).
// - Positions are written relative to `origin` so Float32 keeps about a
//   decimetre over Japan (float-precision skill: relative-to-centre).

export type Shape = 'circle' | 'box' | 'star';
export type Corner = 'round' | 'mitre';

export interface SweepOptions {
  radius: number;              // km, scales the unit shape
  shape: Shape;
  corner: Corner;
  mitreLimit: number;          // the largest stretch a mitre may have
  roundStepDeg: number;
  origin: number[];            // subtracted from every position
}

export interface Mesh {
  centre: Float32Array;        // xyz per vertex, relative to origin: the ring's centre
  offset: Float32Array;        // xyz per vertex: from the centre to the surface, km
  normal: Int8Array;           // xyz * 127 and the line index, per vertex
  along: Float32Array;         // km from the start of the line, per vertex
  index: Uint32Array;
  sidesPerRing: number;
  smooth: boolean;
  bandTriangles: number;
  // per ring, for tests and bench checks
  ringStart: number[];
  capStart: number;            // cap vertices follow every ring vertex
  ringLine: number[];
  ringAlong: number[];
  frameCentre: number[];       // xyz per ring, absolute
  frameUp: number[];
  frameTangent: number[];
}

export const CIRCLE_SIDES = 24;
export const BOX_HALF = 0.85;           // half side, so the box has about the circle's area
export const STAR_ARMS = 7, STAR_OUTER = 1.25, STAR_INNER = 0.7; // Cesium's star: 7 arms, 70 and 50 km

export function shapeOutline(shape: Shape): { points: number[][]; smooth: boolean } {
  if (shape === 'circle') {
    const points: number[][] = [];
    for (let i = 0; i < CIRCLE_SIDES; i++) { const a = (i / CIRCLE_SIDES) * 2 * Math.PI; points.push([Math.cos(a), Math.sin(a)]); }
    return { points, smooth: true };
  }
  if (shape === 'box') {
    const h = BOX_HALF;
    return { points: [[-h, -h], [h, -h], [h, h], [-h, h]], smooth: false };
  }
  const points: number[][] = [];
  for (let i = 0; i < 2 * STAR_ARMS; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / STAR_ARMS, r = i % 2 === 0 ? STAR_OUTER : STAR_INNER;
    points.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return { points, smooth: false };
}

type V = [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: V, s: number): V => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const subV = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const normalize = (a: V): V => scale(a, 1 / Math.hypot(a[0], a[1], a[2]));
// Rodrigues: v turned by angle a about the unit axis k
const rotate = (v: V, k: V, a: number): V => {
  const c = Math.cos(a), s = Math.sin(a);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, dot(k, v) * (1 - c)));
};

export function sweep(lines: ArrayLike<number>[], o: SweepOptions): Mesh {
  const { points, smooth } = shapeOutline(o.shape);
  const P = points.length;
  // 2D outward normal of each edge (k -> k+1) of the counter-clockwise outline
  const edgeN = points.map((p, k) => {
    const q = points[(k + 1) % P], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy);
    return [dy / l, -dx / l];
  });
  const perRing = smooth ? P : 2 * P;
  const centre: number[] = [], offset: number[] = [], normal: number[] = [], along: number[] = [];
  const index: number[] = [];
  const m = {
    ringStart: [] as number[], ringLine: [] as number[], ringAlong: [] as number[],
    frameCentre: [] as number[], frameUp: [] as number[], frameTangent: [] as number[],
  };
  const caps: { c: V; t: V; s: V; u: V; line: number; along: number; end: boolean }[] = [];
  const origin = o.origin;
  const r = o.radius, step = (o.roundStepDeg * Math.PI) / 180;
  let bandTriangles = 0;

  const pushVertex = (c: V, off: V, n: V, line: number, a: number) => {
    centre.push(c[0] - origin[0], c[1] - origin[1], c[2] - origin[2]);
    offset.push(off[0], off[1], off[2]);
    normal.push(Math.round(n[0] * 127), Math.round(n[1] * 127), Math.round(n[2] * 127), line);
    along.push(a);
  };

  for (let li = 0; li < lines.length; li++) {
    const src = lines[li];
    const pts: V[] = [];
    for (let i = 0; i + 2 < src.length; i += 3) {
      const p: V = [src[i], src[i + 1], src[i + 2]];
      if (!pts.length || Math.hypot(...subV(p, pts[pts.length - 1])) > 1e-6) pts.push(p);
    }
    if (pts.length < 2) continue;
    const T: V[] = [], L: number[] = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const d = subV(pts[i + 1], pts[i]);
      L.push(Math.hypot(...d));
      T.push(normalize(d));
    }
    // seed: the radial at the first point, made perpendicular to the tangent
    const rad = normalize(pts[0]);
    let up = normalize(subV(rad, scale(T[0], dot(rad, T[0]))));
    let dist = 0;
    let ringsInLine = 0;

    // A ring: centre c, frame (t, up), side = up x t, so that (side, up, t)
    // is right-handed and the outline appears counter-clockwise from ahead.
    // mitre: the incoming frame; each point is placed in it and pushed along
    // the incoming tangent onto the plane through c with normal t (the
    // bisector plane). Normals keep the frame (t, u).
    const ring = (c: V, t: V, u: V, a: number, mitre: { tin: V; uin: V } | null) => {
      const s = cross(u, t);
      if (ringsInLine > 0) {
        // band to the previous ring
        const r0 = centre.length / 3 - perRing;
        for (let k = 0; k < P; k++) {
          const a0 = smooth ? r0 + k : r0 + 2 * k, b0 = smooth ? r0 + ((k + 1) % P) : r0 + 2 * k + 1;
          const a1 = a0 + perRing, b1 = b0 + perRing;
          index.push(a0, b0, a1, b0, b1, a1);
        }
        bandTriangles += 2 * P;
      }
      m.ringStart.push(centre.length / 3);
      m.ringLine.push(li);
      m.ringAlong.push(a);
      m.frameCentre.push(...c);
      m.frameUp.push(...u);
      m.frameTangent.push(...t);
      const sIn = mitre ? cross(mitre.uin, mitre.tin) : s, uIn = mitre ? mitre.uin : u;
      const place = (x: number, y: number): V => {
        const off = add(scale(sIn, x * r), scale(uIn, y * r));
        return mitre ? subV(off, scale(mitre.tin, dot(off, t) / dot(mitre.tin, t))) : off;
      };
      for (let k = 0; k < P; k++) {
        const [x, y] = points[k];
        if (smooth) {
          pushVertex(c, place(x, y), normalize(add(scale(s, x), scale(u, y))), li, a);
        } else {
          const q = points[(k + 1) % P], n = normalize(add(scale(s, edgeN[k][0]), scale(u, edgeN[k][1])));
          pushVertex(c, place(x, y), n, li, a);
          pushVertex(c, place(q[0], q[1]), n, li, a);
        }
      }
      ringsInLine++;
    };

    caps.push({ c: pts[0], t: T[0], s: cross(up, T[0]), u: up, line: li, along: 0, end: false });
    ring(pts[0], T[0], up, 0, null);
    for (let i = 1; i + 1 < pts.length; i++) {
      dist += L[i - 1];
      const tin = T[i - 1], tout = T[i];
      const theta = Math.acos(Math.max(-1, Math.min(1, dot(tin, tout))));
      const ax = cross(tin, tout), axLen = Math.hypot(...ax);
      if (theta < 1e-9 || axLen < 1e-12) { ring(pts[i], tin, up, dist, null); continue; }
      const k = scale(ax, 1 / axLen);
      const stretch = 1 / Math.cos(theta / 2);
      if (theta < step || (o.corner === 'mitre' && stretch <= o.mitreLimit)) {
        const mid = rotate(tin, k, theta / 2);
        ring(pts[i], mid, rotate(up, k, theta / 2), dist, { tin, uin: up });
      } else {
        const n = Math.ceil(theta / step);
        for (let j = 0; j <= n; j++) ring(pts[i], rotate(tin, k, (theta * j) / n), rotate(up, k, (theta * j) / n), dist, null);
      }
      up = normalize(rotate(up, k, theta));
      up = normalize(subV(up, scale(tout, dot(up, tout))));
    }
    dist += L[L.length - 1];
    const tl = T[T.length - 1];
    ring(pts[pts.length - 1], tl, up, dist, null);
    caps.push({ c: pts[pts.length - 1], t: tl, s: cross(up, tl), u: up, line: li, along: dist, end: true });
  }

  const capStart = centre.length / 3;
  for (const cap of caps) {
    const n = cap.end ? cap.t : scale(cap.t, -1);
    const base = centre.length / 3;
    pushVertex(cap.c, [0, 0, 0], n, cap.line, cap.along);
    for (const [x, y] of points) pushVertex(cap.c, add(scale(cap.s, x * r), scale(cap.u, y * r)), n, cap.line, cap.along);
    for (let k = 0; k < P; k++) {
      const a = base + 1 + k, b = base + 1 + ((k + 1) % P);
      if (cap.end) index.push(base, a, b); else index.push(base, b, a);
    }
  }

  return {
    centre: new Float32Array(centre), offset: new Float32Array(offset), normal: new Int8Array(normal),
    along: new Float32Array(along), index: new Uint32Array(index),
    sidesPerRing: P, smooth, bandTriangles, capStart, ...m,
  };
}
