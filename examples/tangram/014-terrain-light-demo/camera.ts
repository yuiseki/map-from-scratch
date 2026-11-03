// Orbit camera over local metres (x east, y north, z up). bearing is the
// direction the camera looks, clockwise from north; tilt is the angle of the
// line of sight below the horizon (90° = straight down). The eye stands
// opposite the bearing, so up = right x forward points to the sky
// (rendering-mistakes.md: "An upside-down camera").
export interface Cam { tx: number; ty: number; tz: number; bearing: number; tilt: number; dist: number; fovy: number }
type V3 = [number, number, number];

export const TILT_MIN = 0.12, TILT_MAX = 1.5, DIST_MIN = 2500, DIST_MAX = 120000;
const ORBIT_PER_PX = 0.005, TILT_PER_PX = 0.004;

export function basis(c: Cam): { f: V3; r: V3; u: V3 } {
  const sb = Math.sin(c.bearing), cb = Math.cos(c.bearing), st = Math.sin(c.tilt), ct = Math.cos(c.tilt);
  const f: V3 = [sb * ct, cb * ct, -st], r: V3 = [cb, -sb, 0];
  const u: V3 = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  return { f, r, u };
}

export function eye(c: Cam): V3 {
  const { f } = basis(c);
  return [c.tx - f[0] * c.dist, c.ty - f[1] * c.dist, c.tz - f[2] * c.dist];
}

// Column-major projection x view. Positions are relative to the eye (the
// vertex shader subtracts it), so float32 never holds 40 km offsets twice.
export function viewProj(c: Cam, aspect: number): Float32Array {
  const { f, r, u } = basis(c);
  const n = c.dist * 0.02, fa = c.dist * 4, t = 1 / Math.tan(c.fovy / 2);
  const a = (fa + n) / (n - fa), b = (2 * fa * n) / (n - fa);
  // rows of the view rotation: r, u, -f
  const m = new Float32Array(16);
  for (let k = 0; k < 3; k++) {
    m[k * 4 + 0] = (t / aspect) * r[k];
    m[k * 4 + 1] = t * u[k];
    m[k * 4 + 2] = -a * f[k];
    m[k * 4 + 3] = f[k];
  }
  m[14] = b;
  return m;
}

// Screen position in CSS px (y down) of a world point, or null behind the eye.
export function project(c: Cam, p: readonly number[], w: number, h: number): { x: number; y: number } | null {
  const e = eye(c), { f, r, u } = basis(c), t = 1 / Math.tan(c.fovy / 2);
  const d = [p[0] - e[0], p[1] - e[1], p[2] - e[2]];
  const z = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
  if (z <= 0) return null;
  const x = (d[0] * r[0] + d[1] * r[1] + d[2] * r[2]) * t / (w / h) / z;
  const y = (d[0] * u[0] + d[1] * u[1] + d[2] * u[2]) * t / z;
  return { x: ((x + 1) * w) / 2, y: ((1 - y) * h) / 2 };
}

// Drag right: the near ground follows the pointer to the right (the eye
// orbits clockwise seen from above). Drag down: towards a top-down view.
export function orbit(c: Cam, dx: number, dy: number): Cam {
  c.bearing += dx * ORBIT_PER_PX;
  c.tilt = Math.min(TILT_MAX, Math.max(TILT_MIN, c.tilt + dy * TILT_PER_PX));
  return c;
}

// Zoom by factor about the point of the plane z = tz under the pointer: the
// eye and the target scale about that point, so it stays on the same pixel.
export function zoomAt(c: Cam, factor: number, sx: number, sy: number, w: number, h: number): Cam {
  const dist = Math.min(DIST_MAX, Math.max(DIST_MIN, c.dist * factor));
  const k = dist / c.dist;
  const { f, r, u } = basis(c), e = eye(c), th = Math.tan(c.fovy / 2);
  const nx = (2 * sx) / w - 1, ny = 1 - (2 * sy) / h;
  const d = [0, 1, 2].map((i) => f[i] + r[i] * nx * th * (w / h) + u[i] * ny * th);
  c.dist = dist;
  if (d[2] >= -1e-6) return c;                 // pointer above the horizon: zoom about the target
  const t = (c.tz - e[2]) / d[2];
  const px = e[0] + d[0] * t, py = e[1] + d[1] * t;
  c.tx = px + (c.tx - px) * k;
  c.ty = py + (c.ty - py) * k;
  return c;
}

// The light stands where the pointer is, seen from above the screen centre:
// azimuth from the pointer's angle around the centre (relative to the
// camera's bearing), altitude from its distance (overhead at the centre,
// 1° at half the shorter side).
export const ALT_MIN = Math.PI / 180;
export function lightFromPointer(sx: number, sy: number, w: number, h: number, bearing: number): { az: number; alt: number } {
  const dx = sx - w / 2, dy = sy - h / 2;
  const r = Math.min(1, Math.hypot(dx, dy) / (0.5 * Math.min(w, h)));
  return { az: bearing + Math.atan2(dx, -dy), alt: Math.max(ALT_MIN, (Math.PI / 2) * (1 - r)) };
}
