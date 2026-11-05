export interface MeshCell {
  west: number; south: number; east: number; north: number;
  longitude: number; latitude: number;
}
export interface AccessFeature {
  kind: 'park' | 'school';
  geometry:
    | { type: 'Point'; coordinates: [number, number] }
    | { type: 'Polygon'; coordinates: [number, number][][] }
    | { type: 'MultiPolygon'; coordinates: [number, number][][][] };
}
export interface NeighborhoodScore {
  nearestParkMeters: number; nearestSchoolMeters: number;
  walkableToPark: boolean; walkableToSchool: boolean;
}

const QUADRANTS: Record<string, [number, number]> = {
  '1': [0, 0], '2': [0, 1], '3': [1, 0], '4': [1, 1],
};

/** Decode e-Stat's 10-digit fifth-level (250 m) JIS mesh code. */
export function decodeQuarterMesh(code: string): MeshCell {
  if (!/^\d{10}$/.test(code)) throw new Error(`A 250 m mesh code must contain 10 digits: ${code}`);
  const firstLatitude = Number(code.slice(0, 2)), firstLongitude = Number(code.slice(2, 4));
  const secondLatitude = Number(code[4]), secondLongitude = Number(code[5]);
  const thirdLatitude = Number(code[6]), thirdLongitude = Number(code[7]);
  if (secondLatitude > 7 || secondLongitude > 7 || thirdLatitude > 9 || thirdLongitude > 9) {
    throw new Error(`Invalid first to third mesh digits: ${code}`);
  }
  const quadrants = [QUADRANTS[code[8]!], QUADRANTS[code[9]!]];
  if (!quadrants[0] || !quadrants[1]) throw new Error(`Invalid subdivision digit in 250 m mesh code: ${code}`);
  const baseSouth = (firstLatitude * 40 + secondLatitude * 5 + thirdLatitude * 0.5) / 60;
  const baseWest = 100 + firstLongitude + (secondLongitude * 7.5 + thirdLongitude * 0.75) / 60;
  let southOffset = 0, westOffset = 0, side = 0.25 / 60;
  for (let i = 0; i < quadrants.length; i++) {
    const [row, column] = quadrants[i]!;
    southOffset += row * side;
    westOffset += column * side * 1.5;
    if (i === 0) side /= 2;
  }
  const south = baseSouth + southOffset, west = baseWest + westOffset;
  const north = south + side, east = west + side * 1.5;
  return { west, south, east, north, longitude: (west + east) / 2, latitude: (south + north) / 2 };
}

const radians = (degrees: number) => degrees * Math.PI / 180;
export function distanceMeters(a: readonly [number, number], b: readonly [number, number]): number {
  const lat1 = radians(a[1]), lat2 = radians(b[1]);
  const dLat = lat2 - lat1, dLon = radians(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6_371_008.8 * 2 * Math.asin(Math.sqrt(h));
}

function pointSegmentMeters(point: readonly [number, number], a: readonly [number, number], b: readonly [number, number]): number {
  const scaleX = 111_195 * Math.cos(radians(point[1]));
  const px = (point[0] - a[0]) * scaleX, py = (point[1] - a[1]) * 111_195;
  const bx = (b[0] - a[0]) * scaleX, by = (b[1] - a[1]) * 111_195;
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / (bx * bx + by * by || 1)));
  return Math.hypot(px - t * bx, py - t * by);
}

function pointInRing(point: readonly [number, number], ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!, b = ring[j]!;
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distanceToFeature(point: readonly [number, number], feature: AccessFeature): number {
  if (feature.geometry.type === 'Point') return distanceMeters(point, feature.geometry.coordinates);
  const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let minimum = Infinity;
  for (const polygon of polygons) {
    if (polygon.length && pointInRing(point, polygon[0]!) && !polygon.slice(1).some((hole) => pointInRing(point, hole))) return 0;
    for (const ring of polygon) for (let i = 1; i < ring.length; i++) {
      minimum = Math.min(minimum, pointSegmentMeters(point, ring[i - 1]!, ring[i]!));
    }
  }
  return minimum;
}

export function scoreNeighborhood(center: readonly [number, number], features: readonly AccessFeature[], walkMeters = 400): NeighborhoodScore {
  let nearestParkMeters = Infinity, nearestSchoolMeters = Infinity;
  for (const feature of features) {
    const distance = distanceToFeature(center, feature);
    if (feature.kind === 'park') nearestParkMeters = Math.min(nearestParkMeters, distance);
    else nearestSchoolMeters = Math.min(nearestSchoolMeters, distance);
  }
  return { nearestParkMeters, nearestSchoolMeters,
    walkableToPark: nearestParkMeters <= walkMeters, walkableToSchool: nearestSchoolMeters <= walkMeters };
}
