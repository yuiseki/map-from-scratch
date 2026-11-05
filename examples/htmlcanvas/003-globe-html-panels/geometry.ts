// Camera, projection and panel placement for htmlcanvas-003. Everything is
// float64 on the CPU; the renderer converts a matrix to Float32Array once per
// panel per frame. Matrices are column-major (WebGL and DOMMatrix(init) both
// read 16 numbers in that order).

export type Vec3 = [number, number, number];
export type Mat4 = Float64Array;
export interface Camera { lon: number; lat: number; distance: number }

/** Vertical focal length (1 / tan(fov / 2)): about 59 degrees of field of view. */
export const FOCAL = 1.75;
export const NEAR = 0.05;
export const FAR = 20;
export const MIN_DISTANCE = 2.2;
export const MAX_DISTANCE = 6;
/** Panels float this far above the unit sphere so they never touch the globe's depth. */
export const LIFT = 1.004;

const RAD = Math.PI / 180;

/** Unit vector of a place: lon 0 on +Z, east towards +X, north pole +Y (as threejs-006). */
export function unitVector(lon: number, lat: number): Vec3 {
  const l = lon * RAD, p = lat * RAD;
  return [Math.sin(l) * Math.cos(p), Math.sin(p), Math.cos(l) * Math.cos(p)];
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

/**
 * World to clip. The globe turns so that (lon, lat) faces the camera, which
 * sits on +Z at `distance` and looks down -Z: rotate by -lon about Y, then by
 * +lat about X (north stays up), translate by -distance, then perspective.
 */
export function clipMatrix(c: Camera, aspect: number): Mat4 {
  const a = -c.lon * RAD, b = c.lat * RAD;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
  // Rx(b) * Ry(a), column-major.
  const rot = new Float64Array([
    ca, sb * sa, -cb * sa, 0,
    0, cb, sb, 0,
    sa, -sb * ca, cb * ca, 0,
    0, 0, 0, 1,
  ]);
  const view = new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -c.distance, 1]);
  const nf = 1 / (NEAR - FAR);
  const proj = new Float64Array([
    FOCAL / aspect, 0, 0, 0,
    0, FOCAL, 0, 0,
    0, 0, (FAR + NEAR) * nf, -1,
    0, 0, 2 * FAR * NEAR * nf, 0,
  ]);
  return multiply(proj, multiply(view, rot));
}

/** Where the camera is in world (globe) coordinates. */
export function cameraEye(c: Camera): Vec3 {
  const u = unitVector(c.lon, c.lat);
  return [u[0] * c.distance, u[1] * c.distance, u[2] * c.distance];
}

/** Clip coordinates of a world point. */
export function toClip(m: Mat4, p: Vec3): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) out[r] = m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r];
  return out;
}

/** CSS pixel of a world point on a canvas of width x height CSS px; null behind the camera. */
export function projectWorld(m: Mat4, p: Vec3, width: number, height: number): [number, number] | null {
  const [x, y, , w] = toClip(m, p);
  if (w <= 1e-9) return null;
  return [(x / w + 1) / 2 * width, (1 - y / w) / 2 * height];
}

/**
 * Cosine between the surface normal at a place and the direction to the eye:
 * 1 facing the camera, 0 on the horizon, negative on the far side. A panel
 * lies in the tangent plane at its place, so it faces the camera exactly
 * when this is positive, and then the globe cannot cover any of it (the
 * sphere is entirely on the other side of that plane).
 */
export function facing(c: Camera, lon: number, lat: number): number {
  const n = unitVector(lon, lat), e = cameraEye(c);
  const d: Vec3 = [e[0] - n[0] * LIFT, e[1] - n[1] * LIFT, e[2] - n[2] * LIFT];
  return (n[0] * d[0] + n[1] * d[1] + n[2] * d[2]) / Math.hypot(...d);
}

export interface PanelModel {
  /** Maps the element's CSS box (x right, y down, z = 0) to world coordinates. */
  matrix: Mat4;
  lift: number;
  at(x: number, y: number): Vec3;
}

/**
 * A panel of w x h CSS px lying in the tangent plane of its place, s world
 * units per CSS px, with the bottom centre of the box on the place (the
 * panel's arrow points there) and the box extending north.
 */
export function panelModel(lon: number, lat: number, w: number, h: number, s: number): PanelModel {
  const n = unitVector(lon, lat);
  const l = lon * RAD, p = lat * RAD;
  const east: Vec3 = [Math.cos(l), 0, -Math.sin(l)];
  const north: Vec3 = [-Math.sin(l) * Math.sin(p), Math.cos(p), -Math.cos(l) * Math.sin(p)];
  const o: Vec3 = [0, 1, 2].map((i) => n[i] * LIFT - east[i] * (w / 2) * s + north[i] * h * s) as Vec3;
  const matrix = new Float64Array([
    east[0] * s, east[1] * s, east[2] * s, 0,
    -north[0] * s, -north[1] * s, -north[2] * s, 0,
    n[0], n[1], n[2], 0,
    o[0], o[1], o[2], 1,
  ]);
  return {
    matrix,
    lift: LIFT,
    at: (x, y) => [0, 1, 2].map((i) => o[i] + matrix[i] * x + matrix[4 + i] * y) as Vec3,
  };
}

/**
 * The matrix3d (column-major, DOMMatrix(init) order) that maps the panel
 * element's CSS box to canvas CSS pixels: clip = m * model * (x, y, 0, 1),
 * then screen = viewport(clip), written so that the CSS perspective divide by
 * the 4th row does the clip divide. The z row passes z through (it is not
 * needed for a flat element, but a zero row would make the matrix singular
 * and the browser could not invert it to hit-test the element).
 */
export function cssTransform(m: Mat4, model: PanelModel, width: number, height: number): Mat4 {
  const c = multiply(m, model.matrix);
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    const x = c[col * 4], y = c[col * 4 + 1], w = c[col * 4 + 3];
    out[col * 4] = (x + w) * width / 2;
    out[col * 4 + 1] = (w - y) * height / 2;
    out[col * 4 + 2] = col === 2 ? 1 : 0;
    out[col * 4 + 3] = w;
  }
  // The element is flat (z = 0), so column 2 (the z input) never mixes in.
  out[8] = 0; out[9] = 0; out[11] = 0;
  return out;
}

/** DOMMatrix.transformPoint for (x, y, 0, 1) followed by the divide by w. */
export function applyCss(t: Mat4, x: number, y: number): [number, number] {
  const X = t[0] * x + t[4] * y + t[12];
  const Y = t[1] * x + t[5] * y + t[13];
  const W = t[3] * x + t[7] * y + t[15];
  return [X / W, Y / W];
}

/** Turn the globe by a pointer drag of (dx, dy) CSS px so the centre follows the pointer. */
export function drag(c: Camera, dx: number, dy: number, viewHeight: number): Camera {
  // Screen px per world unit at the front of the globe; one unit of arc there is one radian.
  const pxPerUnit = FOCAL * viewHeight / 2 / (c.distance - 1);
  const lon = c.lon - dx / pxPerUnit / RAD;
  const lat = Math.max(-80, Math.min(80, c.lat + dy / pxPerUnit / RAD));
  return { lon: ((lon + 540) % 360) - 180, lat, distance: c.distance };
}

export function zoom(distance: number, deltaY: number): number {
  return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, distance * Math.exp(deltaY * 0.001)));
}
