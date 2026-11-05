export type Position = [number, number];
export type Ring = Position[];
export type PolygonRings = Ring[];

export interface FloodFeature {
  id: string;
  river: string;
  manager: string;
  depthClass: number | null;
  rawDepth: number | null;
  bounds: [number, number, number, number];
  pickPoint: Position;
  polygons: PolygonRings[];
}

export interface FloodMap {
  schema: 1;
  category: 'maximum';
  crs: 'EPSG:6668';
  bounds: [number, number, number, number];
  origin: Position;
  features: FloodFeature[];
}

export const depthRankOrder = [1, 2, 3, 4, 5, 6] as const;
export const DEPTH_LABELS: Record<number, string> = {
  1: '0–<0.5 m',
  2: '0.5–<3 m',
  3: '3–<5 m',
  4: '5–<10 m',
  5: '10–<20 m',
  6: '≥20 m',
};

export function depthLabel(rank: number | null): string {
  if (rank === null) return 'Unknown';
  const label = DEPTH_LABELS[rank];
  if (!label) throw new Error(`Invalid depth class ${rank}`);
  return label;
}

/** Approximate local equirectangular view in metres; sufficient for this 5.5 km extent. */
export function projectLocal(position: Position, origin: Position): Position {
  const [lon, lat] = position;
  const [originLon, originLat] = origin;
  const metresPerDegreeLat = 111_132;
  const metresPerDegreeLon = 111_320 * Math.cos(originLat * Math.PI / 180);
  const x = (lon - originLon) * metresPerDegreeLon;
  const y = -(lat - originLat) * metresPerDegreeLat;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}

/** Convert wheel line/page deltas to continuous, bounded zoom factors. */
export function wheelZoomFactor(deltaY: number, deltaMode: number, lineHeight = 16, pageHeight = 800): number {
  if (![deltaY, deltaMode, lineHeight, pageHeight].every(Number.isFinite) || deltaMode < 0 || deltaMode > 2 || lineHeight <= 0 || pageHeight <= 0) {
    throw new RangeError('Invalid wheel delta');
  }
  const deltaPixels = deltaY * (deltaMode === 1 ? lineHeight : deltaMode === 2 ? pageHeight : 1);
  const bounded = Math.max(-180, Math.min(180, deltaPixels));
  return Math.exp(-bounded * 0.0015);
}

export function serializeFloodMap(map: FloodMap): string {
  validateFloodMap(map);
  return JSON.stringify(map);
}

export function validateFloodMap(map: FloodMap): void {
  if (map.schema !== 1 || map.category !== 'maximum' || map.crs !== 'EPSG:6668') throw new Error('Unsupported flood map schema/category/CRS');
  const [west, south, east, north] = map.bounds;
  if (!(west < east && south < north)) throw new Error('Invalid selection bounds');
  if (map.features.length === 0) throw new Error('Flood map has no features');
  const ids = new Set<string>();
  for (const feature of map.features) {
    if (!feature.id || ids.has(feature.id)) throw new Error(`Missing or duplicate feature id ${feature.id}`);
    ids.add(feature.id);
    if (!feature.river || !feature.manager) throw new Error(`Missing river/manager for ${feature.id}`);
    const [pickLon, pickLat] = feature.pickPoint;
    if (!Number.isFinite(pickLon) || !Number.isFinite(pickLat) || pickLon < west || pickLon > east || pickLat < south || pickLat > north) {
      throw new Error(`Pick point outside selection bounds for ${feature.id}`);
    }
    if (feature.depthClass === null) {
      if (feature.rawDepth !== null) throw new Error(`Unknown depth has raw value for ${feature.id}`);
    } else if (!depthRankOrder.includes(feature.depthClass as typeof depthRankOrder[number]) || feature.rawDepth !== feature.depthClass) {
      throw new Error(`Invalid depth class for ${feature.id}`);
    }
    if (!feature.polygons.length) throw new Error(`No polygon geometry for ${feature.id}`);
    const [featureWest, featureSouth, featureEast, featureNorth] = feature.bounds;
    if (!(featureWest <= featureEast && featureSouth <= featureNorth)
        || featureWest < west - 1e-8 || featureEast > east + 1e-8 || featureSouth < south - 1e-8 || featureNorth > north + 1e-8) {
      throw new Error(`Invalid feature bounds for ${feature.id}`);
    }
    let geometryWest = Infinity, geometrySouth = Infinity, geometryEast = -Infinity, geometryNorth = -Infinity;
    for (const polygon of feature.polygons) {
      if (!polygon.length) throw new Error(`No rings for ${feature.id}`);
      for (const ring of polygon) {
        if (ring.length < 3) throw new Error(`Ring too short for ${feature.id}`);
        for (const [lon, lat] of ring) {
          if (!Number.isFinite(lon) || !Number.isFinite(lat)) throw new Error(`Invalid coordinate for ${feature.id}`);
          if (lon < west - 1e-8 || lon > east + 1e-8 || lat < south - 1e-8 || lat > north + 1e-8) {
            throw new Error(`Coordinate outside selection bounds for ${feature.id}`);
          }
          geometryWest = Math.min(geometryWest, lon); geometryEast = Math.max(geometryEast, lon);
          geometrySouth = Math.min(geometrySouth, lat); geometryNorth = Math.max(geometryNorth, lat);
        }
      }
    }
    if (featureWest > geometryWest + 1e-8 || featureSouth > geometrySouth + 1e-8
        || featureEast < geometryEast - 1e-8 || featureNorth < geometryNorth - 1e-8) {
      throw new Error(`Feature bounds do not enclose geometry for ${feature.id}`);
    }
  }
}

function pointInRing(point: Position, ring: Ring): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!;
    const [xj, yj] = ring[j]!;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: Position, polygon: PolygonRings): boolean {
  if (!polygon.length || !pointInRing(point, polygon[0]!)) return false;
  for (let i = 1; i < polygon.length; i++) if (pointInRing(point, polygon[i]!)) return false;
  return true;
}

export function featureAt(features: readonly FloodFeature[], point: Position): FloodFeature | null {
  let picked: FloodFeature | null = null;
  for (let i = features.length - 1; i >= 0; i--) {
    const feature = features[i]!;
    const [west, south, east, north] = feature.bounds;
    if (point[0] < west || point[0] > east || point[1] < south || point[1] > north) continue;
    if (!feature.polygons.some((polygon) => pointInPolygon(point, polygon))) continue;
    if (picked === null || (feature.depthClass ?? 0) > (picked.depthClass ?? 0)) picked = feature;
  }
  return picked;
}
