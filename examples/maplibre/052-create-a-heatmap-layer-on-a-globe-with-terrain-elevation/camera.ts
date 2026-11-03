// A globe camera that is a globe at every zoom. MapLibre switches from the
// globe to a flat Mercator view around zoom 12 and blends the two; this
// renderer stops at zoom 12 and never flattens, so zooming from the pitched
// Ou mountains out to the whole Earth is one continuous camera move. The
// scale at the centre matches MapLibre's: the globe radius in pixels is
// worldSize / (2 pi cos(lat)) (src/geo/projection/globe_utils.ts,
// getGlobeRadiusPixels, BSD-3-Clause), so zoom 9 here is zoom 9 there.
//
// Coordinates: earth-centred, x towards (0 E, 0 N), y towards 90 E, z north,
// metres, on a sphere of EARTH_R. The shader receives clip = M * (p - eye).

export const EARTH_R = 6371008.8;
export const FOV = 0.6435011087932844;   // vertical, MapLibre's default (36.87 deg)
export const MAX_ZOOM = 12, MIN_ZOOM = 0.5, MAX_PITCH = 80;

export interface View {
  lon: number; lat: number; zoom: number;
  pitch: number;      // degrees from looking straight down
  bearing: number;    // degrees clockwise from north
  centerH: number;    // ground height at the centre, m
  width: number; height: number;   // drawing buffer, px
}

export interface Frame {
  eye: [number, number, number];
  up: [number, number, number];
  right: [number, number, number];
  fwd: [number, number, number];
  m: Float64Array;    // projection * rotation, column-major, applied to p - eye
  near: number; far: number;
  width: number; height: number;
}

const D = Math.PI / 180;
type V3 = [number, number, number];
const add = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function ecef(lon: number, lat: number, h: number): V3 {
  const r = EARTH_R + h, cl = Math.cos(lat * D);
  return [r * cl * Math.cos(lon * D), r * cl * Math.sin(lon * D), r * Math.sin(lat * D)];
}

/** Metres per screen pixel at the centre of the view. */
export const metresPerPixel = (zoom: number, lat: number): number =>
  (2 * Math.PI * EARTH_R * Math.cos(lat * D)) / (512 * 2 ** zoom);

const focalPx = (height: number) => (0.5 * height) / Math.tan(FOV / 2);

export function frame(v: View): Frame {
  const lo = v.lon * D, la = v.lat * D, b = v.bearing * D, p = v.pitch * D;
  const U: V3 = [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
  const E: V3 = [-Math.sin(lo), Math.cos(lo), 0];
  const N: V3 = [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)];
  const H = add([N[0] * Math.cos(b), N[1] * Math.cos(b), N[2] * Math.cos(b)], E, Math.sin(b));
  const F = add([-U[0] * Math.cos(p), -U[1] * Math.cos(p), -U[2] * Math.cos(p)], H, Math.sin(p));   // eye -> centre
  const up = add([U[0] * Math.sin(p), U[1] * Math.sin(p), U[2] * Math.sin(p)], H, Math.cos(p));
  const right = cross(F, up);
  const dist = focalPx(v.height) * metresPerPixel(v.zoom, v.lat);
  const centre = ecef(v.lon, v.lat, v.centerH);
  const eye = add(centre, F, -dist);
  // Depth range: from just above the highest ground below the eye to the
  // horizon of the sphere plus the far side of mountains peeking over it.
  const r = Math.hypot(...eye), alt = r - EARTH_R;
  const far = Math.sqrt(Math.max(0, r * r - EARTH_R * EARTH_R)) + 400e3 + dist;
  const near = Math.max(30, Math.min(dist * 0.5, (alt - 3000) * 0.5));
  const f = 1 / Math.tan(FOV / 2), aspect = v.width / v.height, nf = 1 / (near - far);
  // view rows: right, up, -F
  const V = [right, up, [-F[0], -F[1], -F[2]] as V3];
  const P = [f / aspect, f, (far + near) * nf, 2 * far * near * nf];
  const m = new Float64Array(16);
  for (let c = 0; c < 3; c++) {
    m[c * 4 + 0] = P[0] * V[0][c];
    m[c * 4 + 1] = P[1] * V[1][c];
    m[c * 4 + 2] = P[2] * V[2][c];
    m[c * 4 + 3] = -V[2][c];
  }
  m[12] = 0; m[13] = 0; m[14] = P[3]; m[15] = 0;
  return { eye, up, right, fwd: F, m, near, far, width: v.width, height: v.height };
}

/** Screen position (px, y down) and NDC depth, or null when behind the eye or the sphere. */
export function project(f: Frame, lon: number, lat: number, h: number): [number, number, number] | null {
  const p = ecef(lon, lat, h), d: V3 = [p[0] - f.eye[0], p[1] - f.eye[1], p[2] - f.eye[2]];
  const ground = ecef(lon, lat, 0);
  if (dot(d, ground) > 0) return null;                 // the eye is below this point's horizon
  const m = f.m;
  const x = m[0] * d[0] + m[4] * d[1] + m[8] * d[2] + m[12];
  const y = m[1] * d[0] + m[5] * d[1] + m[9] * d[2] + m[13];
  const z = m[2] * d[0] + m[6] * d[1] + m[10] * d[2] + m[14];
  const w = m[3] * d[0] + m[7] * d[1] + m[11] * d[2] + m[15];
  if (w <= 0) return null;
  return [((x / w + 1) / 2) * f.width, ((1 - y / w) / 2) * f.height, z / w];
}

/** Apparent radius of the globe's rim around the centre of a view at pitch 0, px. */
export function limbPx(v: View): number {
  const r = Math.hypot(...frame({ ...v, pitch: 0 }).eye);
  return focalPx(v.height) * Math.tan(Math.asin(EARTH_R / r));
}

/** The original's sky: 'atmosphere-blend' interpolated 1 at zoom 0 to 0 at zoom 2. */
export const atmosphereBlend = (zoom: number): number => Math.max(0, Math.min(1, 1 - zoom / 2));

/** Ray from the eye through screen pixel (sx, sy). */
export function ray(f: Frame, sx: number, sy: number): V3 {
  const t = Math.tan(FOV / 2), ax = ((2 * sx) / f.width - 1) * t * (f.width / f.height), ay = (1 - (2 * sy) / f.height) * t;
  const d = add(add(f.fwd, f.right, ax), f.up, ay), n = Math.hypot(...d);
  return [d[0] / n, d[1] / n, d[2] / n];
}

/** lon, lat where the ray through (sx, sy) meets the sphere of radius EARTH_R + h, or null. */
export function unproject(f: Frame, sx: number, sy: number, h: number): [number, number] | null {
  const d = ray(f, sx, sy), r = EARTH_R + h;
  const b = dot(f.eye, d), c = dot(f.eye, f.eye) - r * r, disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const p = add(f.eye, d, t);
  return [Math.atan2(p[1], p[0]) / D, Math.asin(Math.max(-1, Math.min(1, p[2] / r))) / D];
}
