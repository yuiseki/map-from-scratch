import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateFloodMap, type FloodFeature, type FloodMap, type Position, type PolygonRings } from './flood.ts';

const SOURCE = '/sata_hdd_24tb/www/html/static/ksj/A31a/A31a-25_83_10_GEOJSON-part*.parquet';
const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-26');
const BOUNDS: FloodMap['bounds'] = [139.79, 35.70, 139.85, 35.76];
const ORIGIN: Position = [(BOUNDS[0] + BOUNDS[2]) / 2, (BOUNDS[1] + BOUNDS[3]) / 2];

interface Row {
  id: number; source_file: string; river: string; manager: string; depth_class: number;
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown };
  pick_point: { type: 'Point'; coordinates: [number, number] };
}

function readRows(): Row[] {
  const [west, south, east, north] = BOUNDS;
  const sql = `LOAD spatial;
WITH bounds AS (SELECT ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}) AS geom),
selected AS (
  SELECT source_file, A31a_202 AS river, A31a_204 AS manager, A31a_205 AS depth_class,
    ST_AsGeoJSON(ST_Intersection(src.geometry, bounds.geom))::JSON AS geometry,
    ST_AsGeoJSON(ST_PointOnSurface(ST_Intersection(src.geometry, bounds.geom)))::JSON AS pick_point
  FROM read_parquet('${SOURCE}') AS src, bounds
  WHERE src.A31a_202 = '荒川' AND src.A31a_204 = '関東地方整備局'
    AND src.A31a_205 IS NOT NULL
    AND src.bbox.xmin < ${east} AND src.bbox.xmax > ${west}
    AND src.bbox.ymin < ${north} AND src.bbox.ymax > ${south}
    AND ST_Intersects(src.geometry, bounds.geom)
), numbered AS (
  SELECT row_number() OVER (ORDER BY source_file, river, depth_class, geometry) AS id,
    source_file, river, manager, depth_class, geometry, pick_point FROM selected
)
SELECT id, source_file, river, manager, depth_class, geometry, pick_point FROM numbered ORDER BY id;`;
  const stdout = execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8', maxBuffer: 128 << 20 });
  const start = stdout.indexOf('[{');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB returned no flood rows: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as Row[];
}

function positions(value: unknown, context: string): Position[] {
  if (!Array.isArray(value)) throw new Error(`Invalid polygon ring in ${context}`);
  return value.map((item) => {
    if (!Array.isArray(item) || item.length < 2 || !Number.isFinite(Number(item[0])) || !Number.isFinite(Number(item[1]))) {
      throw new Error(`Invalid position in ${context}`);
    }
    return [Number(item[0]), Number(item[1])];
  });
}

function geometryPolygons(geometry: Row['geometry'], id: string): PolygonRings[] {
  if (geometry.type === 'Polygon') {
    if (!Array.isArray(geometry.coordinates)) throw new Error(`Polygon has no rings: ${id}`);
    return [geometry.coordinates.map((ring, i) => positions(ring, `${id} ring ${i}`))];
  }
  if (geometry.type === 'MultiPolygon') {
    if (!Array.isArray(geometry.coordinates)) throw new Error(`MultiPolygon has no components: ${id}`);
    return geometry.coordinates.map((polygon, p) => {
      if (!Array.isArray(polygon)) throw new Error(`Invalid polygon component ${p}: ${id}`);
      return polygon.map((ring, i) => positions(ring, `${id} polygon ${p} ring ${i}`));
    });
  }
  throw new Error(`Unexpected clipped geometry ${geometry.type} for ${id}`);
}

function vertexCount(feature: FloodFeature): number {
  return feature.polygons.reduce((sum, polygon) => sum + polygon.reduce((rings, ring) => rings + ring.length, 0), 0);
}

function geometryBounds(polygons: PolygonRings[]): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const polygon of polygons) for (const ring of polygon) for (const [lon, lat] of ring) {
    west = Math.min(west, lon); south = Math.min(south, lat);
    east = Math.max(east, lon); north = Math.max(north, lat);
  }
  if (![west, south, east, north].every(Number.isFinite)) throw new Error('Cannot derive bounds from empty clipped geometry');
  return [west, south, east, north];
}

const rows = readRows();
const features: FloodFeature[] = rows.map((row) => {
  if (!Number.isInteger(row.depth_class) || row.depth_class < 1 || row.depth_class > 6) throw new Error(`Unexpected maximum-scale depth class ${row.depth_class}`);
  const id = `${row.source_file}#${row.id}`;
  const polygons = geometryPolygons(row.geometry, id);
  return {
    id,
    river: row.river,
    manager: row.manager,
    depthClass: row.depth_class,
    rawDepth: row.depth_class,
    pickPoint: row.pick_point.coordinates,
    bounds: geometryBounds(polygons),
    polygons,
  };
});
const map: FloodMap = { schema: 1, category: 'maximum', crs: 'EPSG:6668', bounds: BOUNDS, origin: ORIGIN, features };
validateFloodMap(map);

const byDepthClass = Object.fromEntries([1, 2, 3, 4, 5, 6].map((rank) => [rank, features.filter((f) => f.depthClass === rank).length]));
const files = [...new Set(rows.map((row) => row.source_file))].sort();
const mapJson = JSON.stringify(map);
const vertexTotal = features.reduce((sum, feature) => sum + vertexCount(feature), 0);
const stats = {
  dataset: 'KSJ A31a FY2025 maximum-scale flood-inundation polygons',
  sourceUrl: 'https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-A31a-2025.html',
  sourceLicense: 'CC BY 4.0; processed under MLIT KSJ terms',
  sourceCredit: '出典：「国土数値情報（洪水浸水想定区域データ（河川単位））」（国土交通省）を加工して作成',
  sourceDatasetCard: 'hf:ksj-a31a-flood-tokyo23, source card and A31a FY2025 metadata',
  sourcePath: SOURCE,
  sourceFiles: files,
  sourceCrs: 'EPSG:6668 (JGD2011 geographic coordinates)',
  renderedCoordinates: 'JGD2011 longitude/latitude; locally projected at runtime to a north-up equirectangular metre view centered on bbox midpoint',
  category: 'maximum (想定最大規模), A31a_201..A31a_208 attribute group; only 荒川, manager 関東地方整備局',
  selectionBoundsJgd2011: { west: BOUNDS[0], south: BOUNDS[1], east: BOUNDS[2], north: BOUNDS[3] },
  selectionNote: 'Rectangular visual selection, not an administrative boundary; polygons were clipped to this bbox after source geometry intersection.',
  depthField: 'A31a_205: source inundation-depth rank; not a continuous observed depth',
  depthClassDefinitionsMeters: { 1: '0–<0.5', 2: '0.5–<3', 3: '3–<5', 4: '5–<10', 5: '10–<20', 6: '>=20' },
  features: features.length,
  uniqueFeatureIds: new Set(features.map((f) => f.id)).size,
  vertices: vertexTotal,
  byDepthClass,
  sourceFilesPresent: files,
  geometryParts: features.reduce((n, f) => n + f.polygons.length, 0),
  holes: features.reduce((n, f) => n + f.polygons.reduce((p, poly) => p + poly.length - 1, 0), 0),
  jsonBytes: Buffer.byteLength(mapJson),
  interpretation: 'A modeled flood-inundation assumption for the selected river and maximum-scale scenario. Absence of a polygon is not a measured zero and does not guarantee safety; not an observation, forecast, live warning, address guarantee, or individual risk assessment.',
};

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'flood.json'), mapJson);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Day26 Arakawa maximum-scale: ${features.length} clipped polygons, ${vertexTotal} vertices, depth ranks ${JSON.stringify(byDepthClass)}, JSON ${stats.jsonBytes} B`);
