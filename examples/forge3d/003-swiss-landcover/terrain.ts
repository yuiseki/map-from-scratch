// The baked Swiss grid: a height (metres) and a land-cover class per cell,
// class 0 outside the border. World space is metres from the grid centre,
// x east, y north, z up, with heights multiplied by Z_SCALE (forge3d draws
// this scene with a reduced exaggeration; at 420 m cells 1x looks flat).

export const FOV_Y = 40; // degrees, vertical
export const Z_SCALE = 2.5;

export interface Relief {
  width: number;
  height: number;
  heights: Uint16Array;
  classes: Uint8Array;
  minElev: number;
  maxElev: number;
  cellM: number;
  px0: number; // grid origin in z-level pixels (Web Mercator)
  py0: number;
  zoom: number;
}

export interface Camera { az: number; el: number; radius: number } // azimuth/elevation deg, radius m

export interface View {
  eye: number[]; fwd: number[]; right: number[]; up: number[];
  f: number; w: number; h: number; near: number; far: number; m: Float32Array;
}

const sub = (a: number[], b: number[]): number[] => a.map((v, i) => v - b[i]);
const dot = (a: number[], b: number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: number[], b: number[]): number[] => [
  a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0],
];
const norm = (a: number[]): number[] => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return a.map((v) => v / l);
};

export function parseRelief(buf: ArrayBuffer): Relief {
  const dv = new DataView(buf);
  if (String.fromCharCode(...new Uint8Array(buf, 0, 4)) !== 'SWLC') throw new Error('swiss.bin: bad magic');
  const width = dv.getUint16(6, true), height = dv.getUint16(8, true), n = width * height;
  return {
    width, height,
    heights: new Uint16Array(buf, 32, n),
    classes: new Uint8Array(buf, 32 + n * 2, n),
    minElev: dv.getUint16(10, true),
    maxElev: dv.getUint16(12, true),
    cellM: dv.getFloat32(14, true),
    px0: dv.getUint32(18, true),
    py0: dv.getUint32(22, true),
    zoom: dv.getUint16(26, true),
  };
}

// Grid fractions (u east, v south) of a longitude and latitude.
export function uvOf(r: Relief, lon: number, lat: number): [number, number] {
  const n = 2 ** r.zoom * 256, rad = (lat * Math.PI) / 180;
  const x = ((lon + 180) / 360) * n, y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n;
  return [(x - r.px0) / r.width, (y - r.py0) / r.height];
}

// Class (0 outside) of the cell holding (u, v).
export function classAt(r: Relief, u: number, v: number): number {
  const x = Math.floor(u * r.width), y = Math.floor(v * r.height);
  return x < 0 || y < 0 || x >= r.width || y >= r.height ? 0 : r.classes[y * r.width + x];
}

// World position of texel (u, v) given as fractions of the grid (0..1).
export function worldOf(r: Relief, u: number, v: number): number[] {
  const x = (u - 0.5) * (r.width - 1) * r.cellM;
  const y = (0.5 - v) * (r.height - 1) * r.cellM;
  return [x, y, heightAt(r, u, v) * Z_SCALE];
}

export function heightAt(r: Relief, u: number, v: number): number {
  const px = Math.min(r.width - 1, Math.max(0, u * r.width - 0.5));
  const py = Math.min(r.height - 1, Math.max(0, v * r.height - 0.5));
  const x0 = Math.floor(px), y0 = Math.floor(py);
  const x1 = Math.min(r.width - 1, x0 + 1), y1 = Math.min(r.height - 1, y0 + 1);
  const fx = px - x0, fy = py - y0;
  const h = (x: number, y: number): number => r.heights[y * r.width + x];
  const a = h(x0, y0) + (h(x1, y0) - h(x0, y0)) * fx;
  const b = h(x0, y1) + (h(x1, y1) - h(x0, y1)) * fx;
  return a + (b - a) * fy;
}

// eye = target + radius along (azimuth, elevation); looks at the target.
export function makeView(c: Camera, target: number[], w: number, h: number, ground: (x: number, y: number) => number): View {
  const az = (c.az * Math.PI) / 180, el = (c.el * Math.PI) / 180;
  const dir = [Math.sin(az) * Math.cos(el), Math.cos(az) * Math.cos(el), Math.sin(el)];
  const eye = [target[0] + dir[0] * c.radius, target[1] + dir[1] * c.radius, target[2] + dir[2] * c.radius];
  eye[2] = Math.max(eye[2], ground(eye[0], eye[1]) + 120);
  const fwd = norm(sub(target, eye));
  const right = norm(cross(fwd, [0, 0, 1])), up = cross(right, fwd);
  const near = Math.max(50, 0.002 * c.radius), far = c.radius * 2 + 400000;
  const fy = 1 / Math.tan(((FOV_Y / 2) * Math.PI) / 180), fx = fy * h / w;
  const rows = [right.map((v) => v * fx), up.map((v) => v * fy)];
  const za = (far + near) / (near - far), zb = (2 * far * near) / (near - far);
  const m = new Float32Array(16);
  for (let col = 0; col < 3; col++) {
    m[col * 4] = rows[0][col]; m[col * 4 + 1] = rows[1][col];
    m[col * 4 + 2] = -fwd[col] * za; m[col * 4 + 3] = fwd[col];
  }
  m[12] = -dot(rows[0], eye); m[13] = -dot(rows[1], eye);
  m[14] = dot(fwd, eye) * za + zb; m[15] = -dot(fwd, eye);
  return { eye, fwd, right, up, f: (h / 2) * fy, w, h, near, far, m };
}

// Screen position (device px, y down) of a world point, or null behind the eye.
export function project(v: View, p: number[]): [number, number] | null {
  const d = sub(p, v.eye), z = dot(d, v.fwd);
  if (z <= v.near) return null;
  return [v.w / 2 + (dot(d, v.right) * v.f) / z, v.h / 2 - (dot(d, v.up) * v.f) / z];
}

// Terrain height (exaggerated) under a world (x, y); 0 outside the grid.
export function groundAt(r: Relief, x: number, y: number): number {
  const u = x / ((r.width - 1) * r.cellM) + 0.5;
  const v = 0.5 - y / ((r.height - 1) * r.cellM);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  return heightAt(r, u, v) * Z_SCALE;
}
