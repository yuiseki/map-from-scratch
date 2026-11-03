// Geodesy for one city on a globe. Everything is drawn in one local frame:
// east-north-up at Tokyo Station, a rigid transform of ECEF (WGS84). The
// ground is the sphere that osculates the ellipsoid there (Gaussian radius
// sqrt(MN), centre straight below the origin), which matches the ellipsoid to
// a few millimetres across the 15 km of buildings (geo.test.ts) and is close
// enough at globe scale. Doubles stay on the CPU; the GPU receives positions
// relative to the eye (RTC), so float32 is enough near the camera.
export const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), B = A * (1 - F);
const D = Math.PI / 180;

export type V3 = [number, number, number];

export function ecef(latDeg: number, lonDeg: number, h: number): V3 {
  const la = latDeg * D, lo = lonDeg * D, s = Math.sin(la), c = Math.cos(la);
  const n = A / Math.sqrt(1 - E2 * s * s);
  return [(n + h) * c * Math.cos(lo), (n + h) * c * Math.sin(lo), (n * (1 - E2) + h) * s];
}

// Inverse by fixed-point iteration on latitude (converges to 1e-12 rad in a
// handful of steps for any height used here).
export function geodetic(x: number, y: number, z: number): V3 {
  const p = Math.hypot(x, y), lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - E2)), h = 0;
  for (let i = 0; i < 10; i++) {
    const s = Math.sin(lat), n = A / Math.sqrt(1 - E2 * s * s);
    h = Math.abs(Math.cos(lat)) > 1e-9 ? p / Math.cos(lat) - n : Math.abs(z) - B;
    lat = Math.atan2(z, p * (1 - E2 * n / (n + h)));
  }
  return [lat / D, lon / D, h];
}

export interface Frame { lat: number; lon: number; o: V3; e: V3; n: V3; u: V3 }

export function frameAt(latDeg: number, lonDeg: number): Frame {
  const la = latDeg * D, lo = lonDeg * D;
  const sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
  return { lat: latDeg, lon: lonDeg, o: ecef(latDeg, lonDeg, 0), e: [-so, co, 0], n: [-sl * co, -sl * so, cl], u: [cl * co, cl * so, sl] };
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function toLocal(f: Frame, p: V3): V3 {
  const d: V3 = [p[0] - f.o[0], p[1] - f.o[1], p[2] - f.o[2]];
  return [dot(d, f.e), dot(d, f.n), dot(d, f.u)];
}

export function fromLocal(f: Frame, [x, y, z]: V3): V3 {
  return [0, 1, 2].map((i) => f.o[i] + x * f.e[i] + y * f.n[i] + z * f.u[i]) as V3;
}

// A direction (no translation) from ECEF axes into the local frame.
export const dirToLocal = (f: Frame, v: V3): V3 => [dot(v, f.e), dot(v, f.n), dot(v, f.u)];

export function gaussRadius(latDeg: number): number {
  const s = Math.sin(latDeg * D), w = 1 - E2 * s * s;
  return Math.sqrt((A * (1 - E2) / (w * Math.sqrt(w))) * (A / Math.sqrt(w)));
}

// How far the sphere falls below the tangent plane at (X, Y) m from the
// origin. One expression for both sides: the vertex shader is built from
// DROP_EXPR (render.ts), and dropAt is the same text run as JavaScript, so
// the bench projects a roof where the GPU puts it.
export const DROP_EXPR = '-(X * X + Y * Y) / (2.0 * R)';
export const dropAt = new Function('X', 'Y', 'R', `return ${DROP_EXPR};`) as (x: number, y: number, r: number) => number;
export const dropGlsl = (x: string, y: string, r: string): string => DROP_EXPR.replace(/X/g, x).replace(/Y/g, y).replace(/R/g, r);

// The camera: geodetic position, heading clockwise from north, pitch above
// the local horizon (negative looks down). Degrees and metres.
export interface Cam { lat: number; lon: number; h: number; heading: number; pitch: number }

export const eyeLocal = (f: Frame, c: Cam): V3 => toLocal(f, ecef(c.lat, c.lon, c.h));

export interface Basis { right: V3; up: V3; fwd: V3 }

export function cameraBasis(f: Frame, c: Cam): Basis {
  const g = frameAt(c.lat, c.lon);            // the eye's own east-north-up, in ECEF
  const e = dirToLocal(f, g.e), n = dirToLocal(f, g.n), u = dirToLocal(f, g.u);
  const hd = c.heading * D, pt = c.pitch * D;
  const ch = Math.cos(hd), sh = Math.sin(hd), cp = Math.cos(pt), sp = Math.sin(pt);
  const fwd = [0, 1, 2].map((i) => cp * (sh * e[i] + ch * n[i]) + sp * u[i]) as V3;
  const right = [0, 1, 2].map((i) => ch * e[i] - sh * n[i]) as V3;
  const up: V3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  return { right, up, fwd };
}

// Height of a local point above the ground sphere (centre (0, 0, -R)).
export const altitude = (p: V3, R: number): number => Math.hypot(p[0], p[1], p[2] + R) - R;
