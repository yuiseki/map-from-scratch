// Orbit camera over local metres (x east, y north, z up). heading is the
// compass direction the camera looks towards (0 = north), pitch the angle
// below the horizon in degrees.

export type Vec3 = [number, number, number];
export interface OrbitView { target: Vec3; heading: number; pitch: number; distance: number }
export interface CameraMatrices { viewProj: Float32Array; invViewProj: Float32Array; eye: Vec3 }

export const MIN_PITCH = 2;
export const MAX_PITCH = 80;
export const MIN_DISTANCE = 300;
export const MAX_DISTANCE = 60000;
export const FOVY = (40 * Math.PI) / 180;

const D = Math.PI / 180;

export function orbitCamera(v: OrbitView, aspect: number): CameraMatrices {
  const h = v.heading * D, p = v.pitch * D;
  const fwd: Vec3 = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), -Math.sin(p)];
  const eye: Vec3 = [v.target[0] - fwd[0] * v.distance, v.target[1] - fwd[1] * v.distance, v.target[2] - fwd[2] * v.distance];
  const right: Vec3 = [Math.cos(h), -Math.sin(h), 0];
  const up: Vec3 = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  // near and far follow the distance so the 24-bit depth buffer keeps
  // resolution where the turbines are
  const near = Math.max(5, v.distance * 0.01), far = v.distance + 90000;
  const f = 1 / Math.tan(FOVY / 2);
  // view (column-major), camera looks down -Z
  const view = [
    right[0], up[0], -fwd[0], 0,
    right[1], up[1], -fwd[1], 0,
    right[2], up[2], -fwd[2], 0,
    -dot(right, eye), -dot(up, eye), dot(fwd, eye), 1,
  ];
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
  const viewProj = mul(proj, view);
  return { viewProj, invViewProj: invert(viewProj), eye };
}

function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float32Array {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function invert(m: Float32Array): Float32Array {
  const a = Array.from(m), inv = new Array<number>(16).fill(0);
  // Gauss-Jordan on the 4x4, column-major in and out
  const M = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => a[c * 4 + r]));
  const I = [0, 1, 2, 3].map((r) => [0, 1, 2, 3].map((c) => (r === c ? 1 : 0)));
  for (let c = 0; c < 4; c++) {
    let p = c;
    for (let r = c + 1; r < 4; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    [I[c], I[p]] = [I[p], I[c]];
    const d = M[c][c];
    for (let k = 0; k < 4; k++) { M[c][k] /= d; I[c][k] /= d; }
    for (let r = 0; r < 4; r++) if (r !== c) {
      const f = M[r][c];
      for (let k = 0; k < 4; k++) { M[r][k] -= f * M[c][k]; I[r][k] -= f * I[c][k]; }
    }
  }
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) inv[c * 4 + r] = I[r][c];
  return new Float32Array(inv);
}

// Screen pixel (x right, y down) of a world point, or null behind the eye.
export function project(m: Float32Array, p: ArrayLike<number>, w: number, h: number): [number, number, number] | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const q = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (q <= 0) return null;
  return [(x / q * 0.5 + 0.5) * w, (0.5 - y / q * 0.5) * h, z / q];
}

// Drag in CSS pixels: right turns the view to the right, down looks
// further down.
export function orbitDrag(v: OrbitView, dx: number, dy: number): OrbitView {
  return {
    ...v,
    heading: (((v.heading + dx * 0.25) % 360) + 360) % 360,
    pitch: Math.min(MAX_PITCH, Math.max(MIN_PITCH, v.pitch + dy * 0.2)),
  };
}

export function zoomDistance(d: number, deltaY: number): number {
  return Math.min(MAX_DISTANCE, Math.max(MIN_DISTANCE, d * Math.exp(deltaY * 0.0015)));
}
