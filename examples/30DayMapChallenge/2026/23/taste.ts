export type FoodCategory = 'eatery' | 'cafe' | 'drinks' | 'food-shop';
export type XY = readonly [number, number];
export interface FoodGeometry { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown }
export interface FoodFeature {
  id: string;
  osmId: number;
  source: 'point' | 'polygon';
  x: number;
  y: number;
  category: FoodCategory;
  tags: Record<string, string>;
  geometry?: FoodGeometry;
}

export function groupFoodFeatures(features: readonly FoodFeature[]): Record<FoodCategory, FoodFeature[]> {
  const groups: Record<FoodCategory, FoodFeature[]> = { eatery: [], cafe: [], drinks: [], 'food-shop': [] };
  for (const feature of features) groups[feature.category].push(feature);
  return groups;
}

export type FoodDetailLevel = 'grid' | 'points' | 'geometry';
export function foodDetailLevel(pixelsPerMeter: number): FoodDetailLevel {
  if (!Number.isFinite(pixelsPerMeter) || pixelsPerMeter <= 0) throw new Error('Map scale must be a positive finite number');
  if (pixelsPerMeter < 0.11) return 'grid';
  if (pixelsPerMeter < 0.22) return 'points';
  return 'geometry';
}
export interface FoodView { x: number; y: number; scale: number; width: number; height: number }
export interface FoodBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface FoodGridCell { x: number; y: number; count: number; categories: Record<FoodCategory, number> }
export interface ProjectedFood { feature: FoodFeature; screenX: number; screenY: number }

const categories = new Set<FoodCategory>(['eatery', 'cafe', 'drinks', 'food-shop']);
const eateries = new Set(['restaurant', 'fast_food', 'food_court', 'ice_cream']);
const cafes = new Set(['cafe']);
const drinks = new Set(['bar', 'pub', 'biergarten', 'nightclub']);
const foodShops = new Set([
  'food', 'bakery', 'confectionery', 'butcher', 'seafood', 'greengrocer', 'deli', 'cheese',
  'wine', 'alcohol', 'coffee', 'tea', 'beverages', 'pastry', 'chocolate', 'spices', 'nuts', 'convenience',
]);

/** Renderer grouping only; values remain exactly the explicit OSM tags. */
export function classifyFoodTags(tags: Readonly<Record<string, string | undefined>>): FoodCategory | null {
  if (tags.amenity && eateries.has(tags.amenity)) return 'eatery';
  if (tags.amenity && cafes.has(tags.amenity)) return 'cafe';
  if (tags.amenity && drinks.has(tags.amenity)) return 'drinks';
  if (tags.shop && foodShops.has(tags.shop)) return 'food-shop';
  return null;
}

/** The source has separate point and polygon tables. Only exact feature keys dedupe. */
export function deduplicateFoodFeatures(features: readonly FoodFeature[]): FoodFeature[] {
  const seen = new Set<string>();
  const output: FoodFeature[] = [];
  for (const feature of features) {
    const key = `${feature.source}:${feature.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(feature);
  }
  return output;
}

export function projectFoodPoint(x: number, y: number, view: FoodView): { x: number; y: number } {
  if (![x, y, view.x, view.y, view.scale, view.width, view.height].every(Number.isFinite) || view.scale <= 0) {
    throw new RangeError('Food coordinates and camera must be finite with a positive scale');
  }
  return { x: (x - view.x) * view.scale + view.width / 2, y: (view.y - y) * view.scale + view.height / 2 };
}

export function insideFoodBounds(x: number, y: number, bounds: FoodBounds): boolean {
  return [x, y, bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
    && bounds.minX <= x && x <= bounds.maxX && bounds.minY <= y && y <= bounds.maxY;
}

export function aggregateFoodGrid(features: readonly FoodFeature[], cellSizeM: number): FoodGridCell[] {
  if (!Number.isFinite(cellSizeM) || cellSizeM <= 0) throw new RangeError('Grid cell size must be positive');
  const cells = new Map<string, FoodGridCell>();
  for (const feature of features) {
    const x = Math.floor(feature.x / cellSizeM), y = Math.floor(feature.y / cellSizeM), key = `${x}:${y}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = { x, y, count: 0, categories: { eatery: 0, cafe: 0, drinks: 0, 'food-shop': 0 } };
      cells.set(key, cell);
    }
    cell.count++;
    cell.categories[feature.category]++;
  }
  return [...cells.values()].sort((a, b) => a.y - b.y || a.x - b.x);
}

export function normalizeCellCount(count: number, maximum: number): number {
  if (!Number.isFinite(count) || !Number.isFinite(maximum) || count < 0 || maximum < 0) {
    throw new RangeError('Grid counts must be finite and non-negative');
  }
  if (maximum === 0 || count === 0) return 0;
  return Math.min(1, Math.log1p(count) / Math.log1p(maximum));
}

export function encodeFoodFeatures(features: readonly FoodFeature[]): string {
  return JSON.stringify(features);
}

function validCoordinatePair(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'number' && Number.isFinite(value[0])
    && typeof value[1] === 'number' && Number.isFinite(value[1]);
}

function validateCoordinates(value: unknown): void {
  if (validCoordinatePair(value)) return;
  if (!Array.isArray(value)) throw new Error('Invalid feature geometry coordinates');
  for (const child of value) validateCoordinates(child);
}

export function decodeFoodFeatures(input: unknown): FoodFeature[] {
  if (!Array.isArray(input)) throw new Error('Food feature payload must be an array');
  return input.map((item, index) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid food feature ${index}`);
    const feature = item as Partial<FoodFeature>;
    if (typeof feature.id !== 'string' || !feature.id || !Number.isSafeInteger(feature.osmId)
        || (feature.source !== 'point' && feature.source !== 'polygon')
        || !Number.isFinite(feature.x) || !Number.isFinite(feature.y)
        || !feature.category || !categories.has(feature.category)
        || !feature.tags || typeof feature.tags !== 'object'
        || Object.entries(feature.tags).some(([key, value]) => !key || typeof value !== 'string')) {
      throw new Error(`Invalid feature identity, category, tags or coordinate at ${index}`);
    }
    if (feature.geometry) {
      if (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon') throw new Error(`Invalid geometry type at ${index}`);
      validateCoordinates(feature.geometry.coordinates);
    }
    return feature as FoodFeature;
  });
}

export function hitTestFoodFeature(x: number, y: number, points: readonly ProjectedFood[], radius: number): ProjectedFood | null {
  if (![x, y, radius].every(Number.isFinite) || radius < 0) throw new RangeError('Hit-test coordinates and radius must be valid');
  let selected: ProjectedFood | null = null;
  let nearest = radius * radius;
  for (const point of points) {
    const dx = point.screenX - x, dy = point.screenY - y, distance = dx * dx + dy * dy;
    if (distance <= nearest) { nearest = distance; selected = point; }
  }
  return selected;
}

export const FOOD_GRID_CELL_METERS = 220;
