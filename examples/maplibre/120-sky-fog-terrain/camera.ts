// Orbit camera over local metres (x east, y north, z up). The target stays
// on the ground; bearing is the view direction clockwise from north, pitch
// the angle from straight down (MapLibre's convention), distance eye-target.
export interface Cam { tx: number; ty: number; tz: number; bearing: number; pitch: number; distance: number }

// MapLibre's default vertical field of view (0.6435 rad = 36.87 deg).
export const FOV_Y = 0.6435011087932844;
export const NEAR = 50, FAR = 600000;           // projection planes, m
export const MAX_PITCH = 85, MIN_DIST = 800, MAX_DIST = 80000;
export const CLEARANCE = 150;                     // eye stays this far above the ground, m

const RAD = Math.PI / 180;

export function eyeOf(c: Cam): [number, number, number] {
  const p = c.pitch * RAD, b = c.bearing * RAD;
  return [c.tx - c.distance * Math.sin(p) * Math.sin(b), c.ty - c.distance * Math.sin(p) * Math.cos(b), c.tz + c.distance * Math.cos(p)];
}

// View matrix alone (column-major), for the view-space depth of the fog.
export function view(c: Cam): Float64Array {
  const e = eyeOf(c);
  let fx = c.tx - e[0], fy = c.ty - e[1], fz = c.tz - e[2];
  const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
  // right = (cos b, -sin b, 0): horizontal, independent of pitch, so the
  // camera never rolls and never turns upside down at pitch 0
  const b = c.bearing * RAD, sx = Math.cos(b), sy = -Math.sin(b), sz = 0;
  const ux = sy * fz - sz * fy, uy = sz * fx - sx * fz, uz = sx * fy - sy * fx;   // up = right x forward
  const m = new Float64Array(16);
  m[0] = sx; m[4] = sy; m[8] = sz; m[12] = -(sx * e[0] + sy * e[1] + sz * e[2]);
  m[1] = ux; m[5] = uy; m[9] = uz; m[13] = -(ux * e[0] + uy * e[1] + uz * e[2]);
  m[2] = -fx; m[6] = -fy; m[10] = -fz; m[14] = fx * e[0] + fy * e[1] + fz * e[2];
  m[15] = 1;
  return m;
}

export function viewProj(c: Cam, aspect: number): Float64Array {
  const v = view(c), f = 1 / Math.tan(FOV_Y / 2), nf = 1 / (NEAR - FAR);
  const p = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (FAR + NEAR) * nf, -1, 0, 0, 2 * FAR * NEAR * nf, 0];
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += p[k * 4 + row] * v[col * 4 + k];
    out[col * 4 + row] = s;
  }
  return out;
}

// World point to CSS pixels, y down; null behind the eye.
export function project(m: Float64Array, [x, y, z]: number[], w: number, h: number): [number, number] | null {
  const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
  const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
  const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (cw <= 0) return null;
  return [(cx / cw + 1) * w / 2, (1 - cy / cw) * h / 2];
}

// Screen row (from the top) of the horizon of a flat world: the direction
// at eye height straight ahead. The sky's gradient is anchored here.
export function horizonY(pitch: number, h: number): number {
  return h / 2 - (h / 2) * Math.tan((90 - pitch) * RAD) / Math.tan(FOV_Y / 2);
}

// Pointer drag in CSS pixels: the ground follows the pointer sideways
// (orbit), dragging down looks further down (MapLibre: pitch -0.5 deg/px).
export function drag(c: Cam, dx: number, dy: number): Cam {
  return { ...c, bearing: (((c.bearing + dx * 0.3) % 360) + 360) % 360, pitch: Math.max(0, Math.min(MAX_PITCH, c.pitch - dy * 0.25)) };
}

export function zoom(c: Cam, deltaY: number): Cam {
  return { ...c, distance: Math.max(MIN_DIST, Math.min(MAX_DIST, c.distance * Math.exp(deltaY * 0.002))) };
}

// Keep the eye CLEARANCE above the ground under it by lowering the pitch
// (the eye then rises on its orbit). ground() is the CPU copy of the heights.
export function clampCamera(c: Cam, ground: (x: number, y: number) => number | null): Cam {
  let out = c;
  for (;;) {
    const e = eyeOf(out), g = ground(e[0], e[1]);
    if (g === null || e[2] >= g + CLEARANCE || out.pitch <= 0) return out;
    out = { ...out, pitch: Math.max(0, out.pitch - 0.25) };
  }
}
