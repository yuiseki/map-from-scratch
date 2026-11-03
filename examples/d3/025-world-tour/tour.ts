export type Vec3 = [number, number, number];
function cartesian([lon, lat]: readonly [number, number]): Vec3 {
  const l = lon * Math.PI / 180, p = lat * Math.PI / 180;
  return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
}
export function greatCirclePoint(a: readonly [number, number], b: readonly [number, number], t: number): Vec3 {
  const k = Math.max(0, Math.min(1, t));
  const u = cartesian(a), v = cartesian(b);
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const omega = Math.acos(dot);
  if (omega < 1e-8) return u;
  const den = Math.sin(omega);
  const x = Math.sin((1 - k) * omega) / den, y = Math.sin(k * omega) / den;
  return [x * u[0] + y * v[0], x * u[1] + y * v[1], x * u[2] + y * v[2]];
}

export type Quaternion = [number, number, number, number];
export function viewQuaternion(lon: number, lat: number): Quaternion {
  const target = cartesian([lon, lat]);
  const from: Vec3 = target, to: Vec3 = [1, 0, 0];
  const dot = Math.max(-1, Math.min(1, from[0] * to[0] + from[1] * to[1] + from[2] * to[2]));
  const cross: Vec3 = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
  const q: Quaternion = [1 + dot, cross[0], cross[1], cross[2]];
  const n = Math.hypot(...q) || 1;
  return q.map((v) => v / n) as Quaternion;
}
export function rotateByQuaternion(q: Quaternion, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
