import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aggregateFoodGrid, classifyFoodTags, decodeFoodFeatures, FOOD_GRID_CELL_METERS, type FoodCategory, type FoodFeature } from './taste.ts';

const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-23');
const SOURCE_ROOT = '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/parquet';
const POINT = `${SOURCE_ROOT}/planet_osm_point.parquet`;
const POLYGON = `${SOURCE_ROOT}/planet_osm_polygon.parquet`;
const bounds = { minX: 15_559_600, minY: 4_256_800, maxX: 15_566_400, maxY: 4_263_800 };
const categories: FoodCategory[] = ['eatery', 'cafe', 'drinks', 'food-shop'];
const amenityValues = ['restaurant', 'fast_food', 'food_court', 'ice_cream', 'cafe', 'bar', 'pub', 'biergarten', 'nightclub'];
const shopValues = ['food', 'bakery', 'confectionery', 'butcher', 'seafood', 'greengrocer', 'deli', 'cheese', 'wine', 'alcohol', 'coffee', 'tea', 'beverages', 'pastry', 'chocolate', 'spices', 'nuts', 'convenience'];
const supported = `amenity IN (${amenityValues.map((value) => `'${value}'`).join(',')}) OR shop IN (${shopValues.map((value) => `'${value}'`).join(',')})`;

function duckRows<T>(sql: string): T[] {
  const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial; ${sql}`], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  const start = output.indexOf('[{'), end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB did not return JSON rows: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(start, end + 1)) as T[];
}

interface SourceRow {
  source: 'point' | 'polygon'; osm_id: number; x: number; y: number;
  amenity: string | null; shop: string | null; name: string | null; cuisine: string | null;
  diet_vegetarian: string | null; diet_vegan: string | null; diet_halal: string | null; diet_kosher: string | null;
  takeaway: string | null; delivery: string | null; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } | null;
}
interface CountRow { source: 'point' | 'polygon'; candidates: number; withAmenityOrShop: number; supported: number }

const area = `ST_MakeEnvelope(${bounds.minX},${bounds.minY},${bounds.maxX},${bounds.maxY})`;
const sourceRows = duckRows<SourceRow>(`
WITH selected AS (
  SELECT 'point' AS source, osm_id, amenity, shop, name, tags, ST_X(way) AS x, ST_Y(way) AS y,
    NULL::JSON AS geometry
  FROM read_parquet('${POINT}')
  WHERE bbox.xmin <= ${bounds.maxX} AND bbox.xmax >= ${bounds.minX} AND bbox.ymin <= ${bounds.maxY} AND bbox.ymax >= ${bounds.minY}
    AND (${supported})
  UNION ALL
  SELECT 'polygon' AS source, osm_id, amenity, shop, name, tags,
    ST_X(ST_PointOnSurface(ST_Intersection(way, ${area}))) AS x,
    ST_Y(ST_PointOnSurface(ST_Intersection(way, ${area}))) AS y,
    ST_AsGeoJSON(ST_Intersection(way, ${area}))::JSON AS geometry
  FROM read_parquet('${POLYGON}')
  WHERE bbox.xmin <= ${bounds.maxX} AND bbox.xmax >= ${bounds.minX} AND bbox.ymin <= ${bounds.maxY} AND bbox.ymax >= ${bounds.minY}
    AND ST_Intersects(way, ${area}) AND (${supported})
)
SELECT source, osm_id, x, y, amenity, shop, name,
  json_extract_string(tags, '$.cuisine') AS cuisine,
  json_extract_string(tags, '$."diet:vegetarian"') AS diet_vegetarian,
  json_extract_string(tags, '$."diet:vegan"') AS diet_vegan,
  json_extract_string(tags, '$."diet:halal"') AS diet_halal,
  json_extract_string(tags, '$."diet:kosher"') AS diet_kosher,
  json_extract_string(tags, '$.takeaway') AS takeaway,
  json_extract_string(tags, '$.delivery') AS delivery,
  geometry FROM selected ORDER BY source, osm_id
`);

const sourceCounts = duckRows<CountRow>(`
WITH food(source, osm_id, amenity, shop, bbox) AS (
  SELECT 'point', osm_id, amenity, shop, bbox FROM read_parquet('${POINT}')
  UNION ALL
  SELECT 'polygon', osm_id, amenity, shop, bbox FROM read_parquet('${POLYGON}')
)
SELECT source, count(*) AS candidates,
  count(*) FILTER (WHERE amenity IS NOT NULL OR shop IS NOT NULL) AS withAmenityOrShop,
  count(*) FILTER (WHERE (${supported})) AS supported
FROM food
WHERE bbox.xmin <= ${bounds.maxX} AND bbox.xmax >= ${bounds.minX} AND bbox.ymin <= ${bounds.maxY} AND bbox.ymax >= ${bounds.minY}
GROUP BY source ORDER BY source
`);

const rawFeatures: FoodFeature[] = sourceRows.flatMap((row) => {
  const osmId = Math.abs(Number(row.osm_id));
  const primitive = row.source === 'point' ? 'node' : Number(row.osm_id) < 0 ? 'relation' : 'way';
  const tags: Record<string, string> = {};
  for (const [key, value] of Object.entries({ amenity: row.amenity, shop: row.shop, name: row.name, cuisine: row.cuisine,
    'diet:vegetarian': row.diet_vegetarian, 'diet:vegan': row.diet_vegan, 'diet:halal': row.diet_halal, 'diet:kosher': row.diet_kosher,
    takeaway: row.takeaway, delivery: row.delivery })) if (typeof value === 'string' && value.length > 0) tags[key] = value;
  const category = classifyFoodTags(tags);
  if (!category) return [];
  const feature: FoodFeature = { id: `${primitive}/${osmId}`, osmId, source: row.source, x: Number(row.x), y: Number(row.y), category, tags };
  if (row.geometry && row.source === 'polygon') feature.geometry = row.geometry;
  return [feature];
});
const featureById = new Map<string, FoodFeature>();
for (const feature of rawFeatures) if (!featureById.has(feature.id)) featureById.set(feature.id, feature);
const features = decodeFoodFeatures([...featureById.values()]);
const grid = aggregateFoodGrid(features, FOOD_GRID_CELL_METERS);
function vertexCount(value: unknown): number {
  if (Array.isArray(value)) return value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
    ? 1 : value.reduce((sum: number, child: unknown) => sum + vertexCount(child), 0);
  return 0;
}
const categoryCounts = Object.fromEntries(categories.map((category) => [category, features.filter((feature) => feature.category === category).length])) as Record<FoodCategory, number>;
const cuisineTagged = features.filter((feature) => feature.tags.cuisine !== undefined).length;
const payload = { release: '2026-08-31', crs: 'EPSG:3857', bounds, gridCellMeters: FOOD_GRID_CELL_METERS, features, grid };
const bytes = Buffer.from(JSON.stringify(payload));
const stats = {
  source: 'hf:osm-tokyo23-src-2026-08, local frozen extract from 2026-08-31',
  sourceUrl: 'https://huggingface.co/datasets/yuiseki/osm-tokyo23-src-2026-08',
  license: 'ODbL-1.0; © OpenStreetMap contributors; derived database share-alike',
  sourceLicenseUrl: 'https://opendatacommons.org/licenses/odbl/1-0/',
  sourceCopyrightUrl: 'https://www.openstreetmap.org/copyright',
  sourceCrs: 'EPSG:3857 meters, GeoParquet 1.1 geo metadata',
  boundsMercator: bounds,
  boundsWgs84Approx: { west: 139.765, east: 139.825, south: 35.685, north: 35.735 },
  sourceCounts: sourceCounts.map((row) => ({ ...row, omittedWithAmenityOrShop: Number(row.withAmenityOrShop) - Number(row.supported) })),
  filteredRows: sourceRows.length,
  renderedFeatures: features.length,
  uniqueSourceIds: features.length,
  duplicateRowsRemoved: rawFeatures.length - features.length,
  sourceGeometry: { point: features.filter((feature) => feature.source === 'point').length, polygon: features.filter((feature) => feature.source === 'polygon').length },
  categoryCounts,
  cuisineTagged,
  cuisineUnspecified: features.length - cuisineTagged,
  renderedCategories: categories,
  gridCellMeters: FOOD_GRID_CELL_METERS,
  occupiedGridCells: grid.length,
  payloadBytes: bytes.byteLength,
  vertices: features.reduce((sum, feature) => sum + (feature.geometry ? vertexCount(feature.geometry.coordinates) : 1), 0),
  dataDisclaimer: 'This map records only explicit amenity/shop/cuisine tags in one frozen community-mapped snapshot. It does not measure taste, food quality, popularity, open status or completeness.',
};
if (features.length !== sourceRows.length || features.length === 0 || features.some((feature) => feature.x < bounds.minX || feature.x > bounds.maxX || feature.y < bounds.minY || feature.y > bounds.maxY)) {
  throw new Error(`Unexpected filtered feature set: ${JSON.stringify({ rows: sourceRows.length, features: features.length })}`);
}
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'taste.json'), bytes);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Taste map: ${features.length} food places (${stats.sourceGeometry.point} points, ${stats.sourceGeometry.polygon} areas), ${grid.length} grid cells, ${bytes.byteLength} bytes`);
