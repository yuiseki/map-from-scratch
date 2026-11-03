// Orbit camera about a target on the ground: heading clockwise from north
// (the direction the camera looks), pitch down from the horizon, distance in
// metres. x is east, y north, z up. Matrices are column-major for WebGL.
export type V3 = [number, number, number];
export interface Orbit { tx: number; ty: number; tz: number; heading: number; pitch: number; distance: number }
export interface View {
  eye: V3; forward: V3; right: V3; up: V3;
  near: number; far: number; fovy: number;
  viewProj: Float32Array;
}

// Cesium's default frustum is 60 degrees; it applies that to the wider side,
// here it is the vertical one, so the SSE denominator is 2 tan(30 degrees).
export const FOVY = Math.PI / 3;
export const MIN_DISTANCE = 30, MAX_DISTANCE = 6000;
const rad = Math.PI / 180;
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function viewOf(o: Orbit, width: number, height: number): View {
  const h = o.heading * rad, p = o.pitch * rad;
  const forward: V3 = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), -Math.sin(p)];
  const right: V3 = [Math.cos(h), -Math.sin(h), 0];
  const up: V3 = [
    right[1] * forward[2] - right[2] * forward[1],
    right[2] * forward[0] - right[0] * forward[2],
    right[0] * forward[1] - right[1] * forward[0],
  ];
  const eye: V3 = [o.tx - forward[0] * o.distance, o.ty - forward[1] * o.distance, o.tz - forward[2] * o.distance];
  // The near plane stays above 1 m so log2 of any eye depth is positive.
  const near = Math.max(1.5, o.distance / 400), far = o.distance * 6 + 3000;
  const f = 1 / Math.tan(FOVY / 2), aspect = width / Math.max(1, height);
  const view = [
    right[0], up[0], -forward[0], 0,
    right[1], up[1], -forward[1], 0,
    right[2], up[2], -forward[2], 0,
    -dot(right, eye), -dot(up, eye), dot(forward, eye), 1,
  ];
  const proj = [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, 2 * far * near / (near - far), 0];
  const viewProj = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += proj[k * 4 + r] * view[c * 4 + k];
    viewProj[c * 4 + r] = s;
  }
  return { eye, forward, right, up, near, far, fovy: FOVY, viewProj };
}

// Screen position (pixels, top row 0) and eye depth of a point.
export function project(v: View, p: V3, width: number, height: number): V3 {
  const m = v.viewProj;
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [(x / w + 1) * width / 2, (1 - y / w) * height / 2, w];
}

export function orbitDrag(o: Orbit, dx: number, dy: number): void {
  o.heading = ((o.heading + dx * 0.3) % 360 + 360) % 360;
  o.pitch = Math.max(5, Math.min(90, o.pitch + dy * 0.25));
}

// Moves the target so the ground under the pointer follows it.
export function panDrag(o: Orbit, dx: number, dy: number, heightPx: number): void {
  const metres = o.distance * 2 * Math.tan(FOVY / 2) / Math.max(1, heightPx);
  const h = o.heading * rad, along = dy * metres / Math.max(0.2, Math.sin(o.pitch * rad));
  o.tx += -Math.cos(h) * dx * metres + Math.sin(h) * along;
  o.ty += Math.sin(h) * dx * metres + Math.cos(h) * along;
}

export function wheelZoom(o: Orbit, deltaY: number): void {
  o.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, o.distance * Math.exp(deltaY * 0.0015)));
}

// Gribb-Hartmann planes (a, b, c, d) with the inside where ax+by+cz+d >= 0.
export function frustumPlanes(m: Float32Array): number[][] {
  const row = (i: number) => [m[i], m[4 + i], m[8 + i], m[12 + i]];
  const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
  return [r0, r1, r2].flatMap((r) => [r3.map((v, i) => v + r[i]), r3.map((v, i) => v - r[i])]);
}

export function boxVisible(planes: number[][], min: V3, max: V3): boolean {
  for (const [a, b, c, d] of planes) {
    const x = a >= 0 ? max[0] : min[0], y = b >= 0 ? max[1] : min[1], z = c >= 0 ? max[2] : min[2];
    if (a * x + b * y + c * z + d < 0) return false;
  }
  return true;
}

export function distanceToBox(p: V3, min: V3, max: V3): number {
  let s = 0;
  for (let a = 0; a < 3; a++) { const d = Math.max(min[a] - p[a], 0, p[a] - max[a]); s += d * d; }
  return Math.sqrt(s);
}
