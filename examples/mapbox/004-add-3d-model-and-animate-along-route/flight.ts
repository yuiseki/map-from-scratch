export type Vec3 = [number, number, number];
export type GeoPoint = [longitude: number, latitude: number];

const TAU = Math.PI * 2;

export function geoToSphere(longitudeDeg: number, latitudeDeg: number, radius = 1): Vec3 {
  if (![longitudeDeg, latitudeDeg, radius].every(Number.isFinite) || radius <= 0) throw new RangeError('Coordinates must be finite and radius positive');
  if (latitudeDeg < -90 || latitudeDeg > 90) throw new RangeError('Latitude must be within [-90, 90] degrees');
  const lon = longitudeDeg * Math.PI / 180;
  const lat = latitudeDeg * Math.PI / 180;
  const cosLat = Math.cos(lat);
  return [Math.sin(lon) * cosLat * radius, Math.sin(lat) * radius, Math.cos(lon) * cosLat * radius];
}

const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const scale = (a: Vec3, n: number): Vec3 => [a[0] * n, a[1] * n, a[2] * n];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (a: Vec3): Vec3 => {
  const length = Math.hypot(...a);
  if (length < 1e-12) throw new RangeError('Cannot normalize a zero-length vector');
  return scale(a, 1 / length);
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export function greatCircleRoute(start: GeoPoint, end: GeoPoint, steps: number, radius = 1): Vec3[] {
  if (!Number.isInteger(steps) || steps < 1) throw new RangeError('steps must be a positive integer');
  const a = normalize(geoToSphere(...start));
  const b = normalize(geoToSphere(...end));
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const route: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const point = angle < 1e-8
      ? normalize(add(scale(a, 1 - t), scale(b, t)))
      : normalize(add(scale(a, Math.sin((1 - t) * angle) / Math.sin(angle)), scale(b, Math.sin(t * angle) / Math.sin(angle))));
    route.push(scale(point, radius));
  }
  return route;
}

export function flightPose(start: GeoPoint, end: GeoPoint, progress: number, altitudeRadius = 1.035): { position: Vec3; forward: Vec3; right: Vec3; up: Vec3 } {
  if (!Number.isFinite(progress) || altitudeRadius <= 1) throw new RangeError('progress must be finite and altitudeRadius must exceed one');
  const t = Math.max(0, Math.min(1, progress));
  const path = greatCircleRoute(start, end, 256, 1);
  const index = Math.min(path.length - 2, Math.floor(t * (path.length - 1)));
  const fraction = t * (path.length - 1) - index;
  const up = normalize(add(scale(path[index], 1 - fraction), scale(path[index + 1], fraction)));
  const chord = normalize(add(path[index + 1], scale(path[index], -1)));
  const forward = normalize(add(chord, scale(up, -dot(chord, up))));
  const right = normalize(cross(up, forward));
  return { position: scale(up, altitudeRadius), forward, right, up };
}

export interface FlightAnimation {
  progress: number;
  propellerAngle: number;
  strobe: number;
  durationSeconds: number;
}

export function animationState(timeMs: number): FlightAnimation {
  if (!Number.isFinite(timeMs)) throw new RangeError('timeMs must be finite');
  const durationSeconds = 18;
  const phase = ((timeMs / 1000) % durationSeconds + durationSeconds) % durationSeconds;
  const strobePhase = (phase * 2.4) % 1;
  return {
    progress: phase / durationSeconds,
    propellerAngle: (phase * 36) % TAU,
    strobe: strobePhase < 0.25 ? 1 : 0,
    durationSeconds,
  };
}

export const FLIGHT_ROUTE: [GeoPoint, GeoPoint] = [[-122.379, 37.621], [-73.778, 40.641]];

export function drawFlightOverlay(ctx: CanvasRenderingContext2D, width: number, height: number, yaw: number, pitch: number, distance: number, timeMs: number): void {
  const animation = animationState(timeMs);
  const aspect = width / height;
  const transform = (p: Vec3): [number, number, number] => {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x = cy * p[0] + sy * p[2];
    const z0 = -sy * p[0] + cy * p[2];
    const y = cp * p[1] - sp * z0;
    const z = sp * p[1] + cp * z0;
    const depth = distance - z;
    return [(x * 1.75 / aspect / depth * 0.5 + 0.5) * width, (0.5 - y * 1.75 / depth * 0.5) * height, z];
  };
  ctx.clearRect(0, 0, width, height);
  const points = greatCircleRoute(...FLIGHT_ROUTE, 96, 1.012).map(transform);
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#63e6ff';
  ctx.shadowColor = '#16c8ff';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  let drawing = false;
  for (const [x, y, z] of points) {
    if (z <= 0) { drawing = false; continue; }
    if (!drawing) { ctx.moveTo(x, y); drawing = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const pose = flightPose(...FLIGHT_ROUTE, animation.progress, 1.055);
  const center = transform(pose.position);
  if (center[2] > 0) {
    ctx.shadowColor = '#ffc857';
    ctx.shadowBlur = animation.strobe ? 22 : 8;
    const world = (forward: number, right: number, vertical: number): Vec3 => add(pose.position, add(scale(pose.forward, forward), add(scale(pose.right, right), scale(pose.up, vertical))));
    const triangles: { points: Vec3[]; color: string }[] = [
      { points: [world(0.076, 0, 0), world(-0.035, -0.006, 0), world(-0.035, 0.006, 0)], color: '#fff1bd' },
      { points: [world(0.014, 0.008, 0), world(-0.018, 0.086, 0), world(-0.037, 0.069, 0)], color: '#ffd36d' },
      { points: [world(0.014, -0.008, 0), world(-0.037, -0.069, 0), world(-0.018, -0.086, 0)], color: '#f5a93b' },
      { points: [world(-0.026, 0.006, 0), world(-0.051, 0.034, 0), world(-0.046, 0.006, 0)], color: '#ffda82' },
      { points: [world(-0.026, -0.006, 0), world(-0.046, -0.006, 0), world(-0.051, -0.034, 0)], color: '#ed9f36' },
    ];
    const projected = triangles.map((triangle) => ({
      ...triangle,
      points: triangle.points.map(transform),
    })).sort((a, b) => a.points.reduce((sum, p) => sum + p[2], 0) - b.points.reduce((sum, p) => sum + p[2], 0));
    for (const triangle of projected) {
      ctx.beginPath();
      ctx.moveTo(triangle.points[0][0], triangle.points[0][1]);
      ctx.lineTo(triangle.points[1][0], triangle.points[1][1]);
      ctx.lineTo(triangle.points[2][0], triangle.points[2][1]);
      ctx.closePath();
      ctx.fillStyle = triangle.color;
      ctx.fill();
    }
    const prop = animation.propellerAngle;
    const nose = world(0.078, 0, 0);
    const propA = transform(add(nose, add(scale(pose.right, Math.cos(prop) * 0.019), scale(pose.up, Math.sin(prop) * 0.019))));
    const propB = transform(add(nose, add(scale(pose.right, -Math.cos(prop) * 0.019), scale(pose.up, -Math.sin(prop) * 0.019))));
    ctx.strokeStyle = '#e9fbff';
    ctx.lineWidth = 1.7;
    ctx.beginPath(); ctx.moveTo(propA[0], propA[1]); ctx.lineTo(propB[0], propB[1]); ctx.stroke();
    const beacon = transform(world(0, 0, 0.003));
    ctx.fillStyle = animation.strobe ? '#ffffff' : '#ff5964';
    ctx.beginPath(); ctx.arc(beacon[0], beacon[1], animation.strobe ? 2.5 : 1.6, 0, TAU); ctx.fill();
  }
  ctx.restore();
}
