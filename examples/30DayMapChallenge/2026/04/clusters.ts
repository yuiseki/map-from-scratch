export type FacilityKind = 0 | 1 | 2 | 3;
export interface Facility { x: number; y: number; kind: FacilityKind }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }
export interface FacilityTags {
  building?: string | null;
  amenity?: string | null;
  shop?: string | null;
  tourism?: string | null;
  leisure?: string | null;
  public_transport?: string | null;
  railway?: string | null;
  highway?: string | null;
}

const FOOD = new Set(['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream', 'pub', 'bar', 'biergarten']);

export function classifyFacility(tags: FacilityTags): FacilityKind | null {
  if (tags.amenity && FOOD.has(tags.amenity)) return 0;
  if (tags.public_transport || tags.railway || tags.highway === 'bus_stop' || tags.amenity === 'bicycle_rental' || tags.amenity === 'taxi') return 2;
  if (tags.shop) return 1;
  if (tags.amenity || tags.tourism || tags.leisure) return 3;
  return null;
}

function quantize(value: number, min: number, max: number): number {
  return Math.max(0, Math.min(65535, Math.round((value - min) / (max - min) * 65535)));
}

export function encodeFacilities(points: Facility[], bounds: Bounds): ArrayBuffer {
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite) || bounds.maxX <= bounds.minX || bounds.maxY <= bounds.minY) {
    throw new Error('Invalid facility bounds');
  }
  const out = new ArrayBuffer(8 + points.length * 6), view = new DataView(out);
  for (const [i, byte] of [...'TFC1'].entries()) view.setUint8(i, byte.charCodeAt(0));
  view.setUint32(4, points.length, true);
  points.forEach(({ x, y, kind }, i) => {
    if (!Number.isFinite(x + y) || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY || !Number.isInteger(kind) || kind < 0 || kind > 3) {
      throw new Error(`Facility at index ${i} is outside the extent or has an invalid category`);
    }
    const offset = 8 + i * 6;
    view.setUint16(offset, quantize(x, bounds.minX, bounds.maxX), true);
    view.setUint16(offset + 2, 65535 - quantize(y, bounds.minY, bounds.maxY), true);
    view.setUint8(offset + 4, kind);
    view.setUint8(offset + 5, 0);
  });
  return out;
}

export type Position = readonly [number, number];
export function encodeOutline(rings: Position[][], bounds: Bounds): ArrayBuffer {
  const segments = rings.flatMap((ring) => ring.slice(1).map((point, i) => [ring[i]!, point] as const));
  const out = new ArrayBuffer(8 + segments.length * 8), view = new DataView(out);
  for (const [i, byte] of [...'TBO1'].entries()) view.setUint8(i, byte.charCodeAt(0));
  view.setUint32(4, segments.length, true);
  segments.forEach(([a, b], i) => {
    const offset = 8 + i * 8;
    view.setUint16(offset, quantize(a[0], bounds.minX, bounds.maxX), true);
    view.setUint16(offset + 2, 65535 - quantize(a[1], bounds.minY, bounds.maxY), true);
    view.setUint16(offset + 4, quantize(b[0], bounds.minX, bounds.maxX), true);
    view.setUint16(offset + 6, 65535 - quantize(b[1], bounds.minY, bounds.maxY), true);
  });
  return out;
}
