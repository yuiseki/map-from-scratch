export const PROJECTION_NAMES = ['Equirectangular', 'Mercator', 'Equal Earth', 'Winkel Tripel'] as const;
export type ProjectionName = typeof PROJECTION_NAMES[number];
export type Point = [number, number];

const DEG = Math.PI / 180;
export const MERCATOR_MAX_LATITUDE = 85.05112878;
const EQUAL_EARTH = { a1: 1.340264, a2: -0.081106, a3: 0.000893, a4: 0.003796 };
const WINKEL_STANDARD_PARALLEL = Math.acos(2 / Math.PI);

/** Project WGS84 degrees to dimensionless coordinates. No library engine is used. */
export function project(name: ProjectionName, longitude: number, latitude: number, clipMercator = true): Point | null {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) || latitude < -90 || latitude > 90) return null;
  const lambda = longitude * DEG;
  let phi = latitude * DEG;
  if (longitude === 0 && latitude === 0) return [0, 0];
  if (name === 'Mercator') {
    if (!clipMercator && Math.abs(latitude) > MERCATOR_MAX_LATITUDE) return null;
    phi = Math.max(-MERCATOR_MAX_LATITUDE, Math.min(MERCATOR_MAX_LATITUDE, latitude)) * DEG;
    return [lambda, Math.log(Math.tan(Math.PI / 4 + phi / 2))];
  }
  if (name === 'Equirectangular') return [lambda, phi];
  if (name === 'Equal Earth') {
    const theta = Math.asin((Math.sqrt(3) / 2) * Math.sin(phi));
    const theta2 = theta * theta;
    const theta6 = theta2 * theta2 * theta2;
    const theta8 = theta6 * theta2;
    const { a1, a2, a3, a4 } = EQUAL_EARTH;
    const denominator = 3 * (9 * a4 * theta8 + 7 * a3 * theta6 + 3 * a2 * theta2 + a1);
    const x = (2 * Math.sqrt(3) * lambda * Math.cos(theta)) / denominator;
    const y = theta * (a4 * theta8 + a3 * theta6 + a2 * theta2 + a1);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  // Winkel Tripel: the arithmetic mean of Aitoff and equirectangular.
  const alpha = Math.acos(Math.max(-1, Math.min(1, Math.cos(phi) * Math.cos(lambda / 2))));
  const sinc = alpha === 0 ? 1 : alpha / Math.sin(alpha);
  const aitoffX = (2 * Math.cos(phi) * Math.sin(lambda / 2)) / sinc;
  const aitoffY = Math.sin(phi) / sinc;
  const x = (aitoffX + lambda * Math.cos(WINKEL_STANDARD_PARALLEL)) / 2;
  const y = (aitoffY + phi) / 2;
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

/** Split a geographic line at +/-180 degrees before projecting to avoid map-spanning chords. */
export function projectSegment(name: ProjectionName, coordinates: readonly Point[]): Point[][] {
  if (coordinates.length < 2) return [];
  const output: Point[][] = [];
  let current: Point[] = [];
  const append = (point: Point | null) => {
    if (!point) {
      if (current.length >= 2) output.push(current);
      current = [];
      return;
    }
    current.push(point);
  };
  append(project(name, coordinates[0]![0], coordinates[0]![1]));
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1]!;
    const b = coordinates[i]!;
    const delta = b[0] - a[0];
    if (Math.abs(delta) > 180) {
      const adjustedB = b[0] + (delta > 180 ? -360 : 360);
      const seam = adjustedB > a[0] ? 180 : -180;
      const t = (seam - a[0]) / (adjustedB - a[0]);
      const latitude = a[1] + (b[1] - a[1]) * t;
      append(project(name, seam, latitude));
      if (current.length >= 2) output.push(current);
      current = [];
      const opposite = -seam;
      append(project(name, opposite, latitude));
    }
    append(project(name, b[0], b[1]));
  }
  if (current.length >= 2) output.push(current);
  return output;
}

export interface ScreenTransform { width: number; height: number; scale: number }
export function screenPoint(point: Point, transform: ScreenTransform): Point | null {
  if (!point.every(Number.isFinite) || !Number.isFinite(transform.scale) || transform.scale <= 0) return null;
  return [transform.width / 2 + point[0] * transform.scale, transform.height / 2 - point[1] * transform.scale];
}
