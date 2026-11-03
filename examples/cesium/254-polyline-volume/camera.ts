// An orbit camera about a target on the sphere: target lon/lat, range (km
// from the target), heading (clockwise from north) and tilt (0 = looking
// straight down). All in float64 on the CPU; the GPU gets a matrix relative
// to a fixed origin near Japan (float-precision skill: relative to centre).
import { EARTH_R, toEcef } from './land.ts';

export interface Cam { lon: number; lat: number; range: number; heading: number; tilt: number }
type V = number[];

export const FOV_Y = (40 * Math.PI) / 180;
export const MIN_RANGE = 5, MAX_RANGE = 30000, MAX_TILT = (75 * Math.PI) / 180;

// All of Japan, slightly tilted; and a close oblique view of the Tokaido
// Shinkansen crossing the Fuji river plain, looking north to Mt Fuji.
export const JAPAN: Cam = { lon: 136.6, lat: 35.6, range: 2300, heading: 0, tilt: 0.25 };
export const FUJI: Cam = { lon: 138.66, lat: 35.21, range: 70, heading: 0, tilt: (65 * Math.PI) / 180 };

const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const axpy = (s: number, a: V, b: V) => [s * a[0] + b[0], s * a[1] + b[1], s * a[2] + b[2]];

export function enu(lon: number, lat: number): { e: V; n: V; u: V } {
  const l = (lon * Math.PI) / 180, p = (lat * Math.PI) / 180;
  return {
    e: [-Math.sin(l), Math.cos(l), 0],
    n: [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)],
    u: [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)],
  };
}

export function frame(c: Cam): { eye: V; dir: V; up: V; right: V } {
  const { e, n, u } = enu(c.lon, c.lat);
  const t = toEcef(c.lon, c.lat, 0);
  const fwd = axpy(Math.sin(c.heading), e, n.map((x) => x * Math.cos(c.heading)));
  const back = axpy(-Math.sin(c.tilt), fwd, u.map((x) => x * Math.cos(c.tilt)));
  const eye = axpy(c.range, back, t);
  const dir = back.map((x) => -x);
  const up = axpy(Math.cos(c.tilt), fwd, u.map((x) => x * Math.sin(c.tilt)));
  return { eye, dir, up, right: cross(dir, up) };
}

// Screen pixel (top-left origin) of an ECEF point, or null behind the eye.
export function project(c: Cam, w: number, h: number, p: V): [number, number] | null {
  const { eye, dir, up, right } = frame(c);
  const v = [p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]];
  const z = dot(v, dir);
  if (z <= 1e-9) return null;
  const f = 1 / Math.tan(FOV_Y / 2);
  return [((dot(v, right) / z) * (f / (w / h)) * 0.5 + 0.5) * w, (0.5 - (dot(v, up) / z) * f * 0.5) * h];
}

// A point on (or just above) the sphere faces the eye.
export function onNearSide(c: Cam, p: V): boolean {
  const { eye } = frame(c);
  return dot(p, [eye[0] - p[0], eye[1] - p[1], eye[2] - p[2]]) > 0;
}

// lon/lat under a screen pixel, or null when the ray misses the globe.
export function pick(c: Cam, w: number, h: number, x: number, y: number): [number, number] | null {
  const { eye, dir, up, right } = frame(c);
  const f = 1 / Math.tan(FOV_Y / 2);
  const sx = ((x / w) * 2 - 1) * (w / h) / f, sy = (1 - (y / h) * 2) / f;
  let d = [dir[0] + right[0] * sx + up[0] * sy, dir[1] + right[1] * sx + up[1] * sy, dir[2] + right[2] * sx + up[2] * sy];
  const l = Math.hypot(d[0], d[1], d[2]);
  d = d.map((v) => v / l);
  const b = dot(eye, d), cc = dot(eye, eye) - EARTH_R * EARTH_R, disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  const p = axpy(t, d, eye);
  return [(Math.atan2(p[1], p[0]) * 180) / Math.PI, (Math.asin(Math.max(-1, Math.min(1, p[2] / EARTH_R))) * 180) / Math.PI];
}

export function clampCam(c: Cam): Cam {
  return {
    lon: ((((c.lon + 180) % 360) + 360) % 360) - 180,
    lat: Math.max(-85, Math.min(85, c.lat)),
    range: Math.max(MIN_RANGE, Math.min(MAX_RANGE, c.range)),
    heading: c.heading,
    tilt: Math.max(0, Math.min(MAX_TILT, c.tilt)),
  };
}

// Drag by (dx, dy) pixels: the ground follows the pointer (at the target).
export function drag(c: Cam, dx: number, dy: number, _w: number, h: number): Cam {
  const s = (c.range * 2 * Math.tan(FOV_Y / 2)) / h;
  // the target moves against the pointer: by -dx along screen right
  // (E cos h - N sin h) and by +dy along the ground forward (N cos h + E sin h)
  const east = (-dx * Math.cos(c.heading) + dy * Math.sin(c.heading)) * s;
  const north = (dx * Math.sin(c.heading) + dy * Math.cos(c.heading)) * s;
  return clampCam({
    ...c,
    lon: c.lon + (east / (EARTH_R * Math.cos((c.lat * Math.PI) / 180))) * (180 / Math.PI),
    lat: c.lat + (north / EARTH_R) * (180 / Math.PI),
  });
}

// Zoom by factor about the pixel (x, y): the ground point under it stays.
export function zoomAt(c: Cam, factor: number, x: number, y: number, w: number, h: number): Cam {
  const g = pick(c, w, h, x, y);
  let n = clampCam({ ...c, range: c.range * factor });
  if (!g) return n;
  for (let i = 0; i < 4; i++) {
    const p = pick(n, w, h, x, y);
    if (!p) break;
    n = clampCam({ ...n, lon: n.lon + (g[0] - p[0]), lat: n.lat + (g[1] - p[1]) });
  }
  return n;
}

export function flyBetween(a: Cam, b: Cam, t: number): Cam {
  if (t <= 0) return { ...a };
  if (t >= 1) return { ...b };
  const e = t * t * (3 - 2 * t);
  const lerp = (x: number, y: number) => x + (y - x) * e;
  return { lon: lerp(a.lon, b.lon), lat: lerp(a.lat, b.lat), range: Math.exp(lerp(Math.log(a.range), Math.log(b.range))), heading: lerp(a.heading, b.heading), tilt: lerp(a.tilt, b.tilt) };
}

// Column-major projection x view, with positions relative to origin.
export function viewProj(c: Cam, aspect: number, origin: V): { m: Float32Array; eyeRel: number[]; near: number; far: number } {
  const { eye, dir, up, right } = frame(c);
  const dEye = Math.hypot(eye[0], eye[1], eye[2]);
  const alt = dEye - EARTH_R;
  const near = Math.max(0.05, (alt - 12) * 0.5);
  const far = Math.sqrt(Math.max(0, dEye * dEye - EARTH_R * EARTH_R)) + 100;
  const er = [eye[0] - origin[0], eye[1] - origin[1], eye[2] - origin[2]];
  const f = 1 / Math.tan(FOV_Y / 2);
  // view rows: right, up, -dir
  const V = [right, up, dir.map((x) => -x)];
  const tv = V.map((r) => -dot(r, er));
  const P = [f / aspect, f, (far + near) / (near - far), (2 * far * near) / (near - far)];
  const m = new Float32Array(16);
  for (let col = 0; col < 3; col++) {
    m[col * 4 + 0] = P[0] * V[0][col];
    m[col * 4 + 1] = P[1] * V[1][col];
    m[col * 4 + 2] = P[2] * V[2][col];
    m[col * 4 + 3] = -V[2][col];
  }
  m[12] = P[0] * tv[0];
  m[13] = P[1] * tv[1];
  m[14] = P[2] * tv[2] + P[3];
  m[15] = -tv[2];
  return { m, eyeRel: er, near, far };
}
