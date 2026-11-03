// The camera, shared by the vertex shader (GLSL below, built from the same
// constants), the pointer handling and the bench's pixel checks.
//
// Model space: the eye looks down -z at the origin. On the globe a point at
// lon/lat and height h (Earth radii) sits at radius 1 + h, rotated so the
// view centre (cam.lon, cam.lat) faces the eye at (0, 0, 1). The flat view
// is equirectangular in radians on the plane z = 1, tangent to the globe at
// the view centre, with the extrusion along +z: the two agree at the centre
// in position and scale, so the toggle can morph between them (t 0 -> 1),
// as MapLibre's GlobeControl animates globe to Mercator. The flat view is
// pitched FLAT_PITCH about the centre so the walls stay visible; a straight
// down view would show only lids.
export interface Camera { lon: number; lat: number; dist: number; t: number }

export const FOV_Y = 30 * Math.PI / 180;
export const FLAT_PITCH = 40 * Math.PI / 180;
export const NEAR = 0.01;
export const MIN_DIST = 1.25, MAX_DIST = 9;

const RAD = Math.PI / 180;

// GLSL twin of modelPos. Inputs: lon, lat in degrees, h in radii; uniforms
// uCenter (lon, lat degrees), uT, uOffset (degrees, world copy in flat view).
export const MODEL_POS_GLSL = `
vec3 modelPos(float lon, float lat, float h) {
  float dl = radians(lon - uCenter.x + uOffset), la = radians(lat), la0 = radians(uCenter.y);
  float r = 1.0 + h;
  vec3 g = r * vec3(cos(la) * sin(dl), sin(la), cos(la) * cos(dl));
  g = vec3(g.x, g.y * cos(la0) - g.z * sin(la0), g.y * sin(la0) + g.z * cos(la0));
  vec3 f = vec3(dl, la - la0, 1.0 + h);
  return mix(g, f, uT);
}`;

export function modelPos(cam: Camera, lon: number, lat: number, h: number, offset = 0): [number, number, number] {
  const dl = (lon - cam.lon + offset) * RAD, la = lat * RAD, la0 = cam.lat * RAD;
  const r = 1 + h;
  const gx = r * Math.cos(la) * Math.sin(dl), gy0 = r * Math.sin(la), gz0 = r * Math.cos(la) * Math.cos(dl);
  const gy = gy0 * Math.cos(la0) - gz0 * Math.sin(la0), gz = gy0 * Math.sin(la0) + gz0 * Math.cos(la0);
  const t = cam.t;
  return [gx + (dl - gx) * t, gy + (la - la0 - gy) * t, gz + (1 + h - gz) * t];
}

export type Mat4 = Float32Array;

function mul(a: Float64Array, b: Float64Array): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// View: pitch about the centre point (0, 0, 1), then move the eye back.
export function viewMatrix(cam: Camera): Float64Array {
  const p = -cam.t * FLAT_PITCH, c = Math.cos(p), s = Math.sin(p);
  // column-major: T(0,0,1 - dist) * Rx(p) * T(0,0,-1)
  const rx = Float64Array.of(1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1);
  const t1 = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -1, 1);
  const t2 = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1 - cam.dist, 1);
  return mul(t2, mul(rx, t1));
}

export function projMatrix(cam: Camera, aspect: number): Float64Array {
  const f = 1 / Math.tan(FOV_Y / 2), n = NEAR, far = cam.dist + 4;
  return Float64Array.of(f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + n) / (n - far), -1, 0, 0, (2 * far * n) / (n - far), 0);
}

export function viewProj(cam: Camera, w: number, h: number): Mat4 {
  return Float32Array.from(mul(projMatrix(cam, w / h), viewMatrix(cam)));
}

function apply(m: Float64Array, [x, y, z]: number[]): number[] {
  return [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
}

// Screen pixel (y down) and NDC depth of a lon/lat/height.
export function project(cam: Camera, w: number, h: number, lon: number, lat: number, hgt: number, offset = 0): [number, number, number] {
  const m = mul(projMatrix(cam, w / h), viewMatrix(cam));
  const [x, y, z, q] = apply(m, modelPos(cam, lon, lat, hgt, offset));
  return [(x / q + 1) * w / 2, (1 - y / q) * h / 2, z / q];
}

// Pixel radius of the globe's silhouette (radius 1) at t = 0.
export function limbRadiusPx(cam: Camera, h: number): number {
  return (h / 2) * Math.tan(Math.asin(1 / cam.dist)) / Math.tan(FOV_Y / 2);
}

// lon/lat on the surface (h = 0) under a pixel, or null off the globe / map.
// Exact for t = 0 and t = 1; mid-morph it answers for the nearer view.
export function unproject(cam: Camera, w: number, h: number, px: number, py: number): [number, number] | null {
  const f = Math.tan(FOV_Y / 2);
  // Ray from the eye in view space, then back into model space.
  let d = [((2 * px) / w - 1) * f * (w / h), (1 - (2 * py) / h) * f, -1];
  let o = [0, 0, 0];
  const p = -cam.t * FLAT_PITCH;
  if (cam.t >= 0.5) {
    // undo T(0,0,1-dist), Rx(p), T(0,0,-1)
    const c = Math.cos(-p), s = Math.sin(-p);
    const rot = (v: number[]) => [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
    o = rot([0, 0, cam.dist - 1]); o[2] += 1;
    d = rot(d);
    if (d[2] >= 0) return null;
    const k = (1 - o[2]) / d[2];
    if (k <= 0) return null;
    const dl = (o[0] + k * d[0]) / RAD, la = (o[1] + k * d[1]) / RAD + cam.lat;
    if (Math.abs(la) > 90) return null;
    let lon = cam.lon + dl;
    lon = ((lon + 180) % 360 + 360) % 360 - 180;
    return [lon, la];
  }
  o = [0, 0, cam.dist];
  const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
  const b = o[2] * d[2];
  const disc = b * b - dd * (o[2] * o[2] - 1);
  if (disc < 0) return null;
  const k = (-b - Math.sqrt(disc)) / dd;
  const x = d[0] * k, y = d[1] * k, z = o[2] + d[2] * k;
  const la0 = cam.lat * RAD;
  // inverse of the rotation about x by la0
  const y0 = y * Math.cos(la0) + z * Math.sin(la0), z0 = -y * Math.sin(la0) + z * Math.cos(la0);
  const lat = Math.asin(Math.max(-1, Math.min(1, y0))) / RAD;
  let lon = cam.lon + Math.atan2(x, z0) / RAD;
  lon = ((lon + 180) % 360 + 360) % 360 - 180;
  return [lon, lat];
}
