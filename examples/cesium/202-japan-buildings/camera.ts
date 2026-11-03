// 4x4 matrices (column-major, Float64 on the CPU; the GPU gets Float32 of
// the product) for an eye at the origin: positions are always sent relative
// to the eye, so the view matrix is a rotation only.
import type { Basis, V3 } from './geo.ts';

export type M4 = Float64Array;

export function mul(a: M4, b: M4): M4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

export function perspective(fovYDeg: number, aspect: number, near: number, far: number): M4 {
  const f = 1 / Math.tan(fovYDeg * Math.PI / 360), o = new Float64Array(16);
  o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far);
  return o;
}

// Rows right, up, -forward; no translation (the eye is the origin).
export function viewOf({ right: r, up: u, fwd: f }: Basis): M4 {
  return new Float64Array([r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, 0, 0, 0, 1]);
}

const norm = (v: number[]): V3 => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a: number[], b: number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function lookAt(eye: V3, target: V3, upHint: V3): M4 {
  const fwd = norm([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]);
  const right = norm(cross(fwd, upHint)), up = cross(right, fwd);
  const v = viewOf({ right, up, fwd });
  // Translation for an eye away from the origin (only the tests use one).
  v[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
  v[13] = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
  v[14] = fwd[0] * eye[0] + fwd[1] * eye[1] + fwd[2] * eye[2];
  return v;
}

// Screen position (CSS px, y down) of an eye-relative point, or null behind.
export function project(m: M4, p: V3, w: number, h: number): [number, number, number] | null {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const z = m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14];
  const q = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  if (q <= 0) return null;
  return [(x / q * 0.5 + 0.5) * w, (0.5 - y / q * 0.5) * h, z / q];
}

// Clip planes from the altitude above the ground sphere: near a twentieth of
// the altitude (a 24-bit depth buffer then resolves a building base from the
// ground to well under a metre at 10 km), far past the horizon.
export function nearFar(alt: number, R: number): [number, number] {
  const h = Math.max(1, alt);
  const near = Math.max(0.5, h * 0.05);
  const far = Math.sqrt(h * (2 * R + h)) * 1.2 + 30000;
  return [near, far];
}
