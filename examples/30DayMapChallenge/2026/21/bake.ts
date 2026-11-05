import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyOsmTags, encodeOsmFeatures, type OSMFeature, type TableName, type XY } from './osm.ts';

const ROOT = resolve('.');
const OUTPUT = resolve(ROOT, 'data/baked/30DayMapChallenge-2026-21');
const SOURCE = '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/parquet';
const BOUNDS_WGS84 = { west: 139.685, south: 35.650, east: 139.715, north: 35.675 };
const BOUNDS_3857 = { xmin: 15_549_663.07145842, ymin: 4_252_568.169330002, xmax: 15_553_002.656182218, ymax: 4_255_993.530861105 };
const TABLES: Array<{ name: TableName; file: string; filter: string; simplify: number }> = [
  { name: 'planet_osm_roads', file: 'planet_osm_roads.parquet', filter: "highway IS NOT NULL OR railway IN ('rail','subway','light_rail','tram','narrow_gauge','monorail')", simplify: 1.2 },
  { name: 'planet_osm_line', file: 'planet_osm_line.parquet', filter: "waterway IN ('river','canal','stream','drain','ditch')", simplify: 1.2 },
  { name: 'planet_osm_polygon', file: 'planet_osm_polygon.parquet', filter: "building IS NOT NULL OR water IS NOT NULL OR \"natural\"='water' OR landuse='reservoir' OR leisure IS NOT NULL OR landuse IN ('grass','forest','recreation_ground') OR \"natural\" IN ('wood','grassland','scrub')", simplify: 0.4 },
  { name: 'planet_osm_point', file: 'planet_osm_point.parquet', filter: "amenity IS NOT NULL OR shop IS NOT NULL OR tourism IS NOT NULL OR railway IN ('station','halt','tram_stop')", simplify: 0 },
];
const TAG_COLUMNS = ['name','ref','highway','railway','building','amenity','shop','tourism','leisure','landuse','natural','water','waterway','aeroway','route','public_transport','landcover','access','surface','bridge','tunnel','layer','place','man_made','historic','emergency','craft','office','barrier','boundary','admin_level','width','lanes','maxspeed','service'];
const quote = (value: string) => value.replaceAll("'", "''");

interface Geometry { type: string; coordinates?: unknown; geometries?: Geometry[] }
interface Row { id: string; properties: Record<string, string | null>; geometry: Geometry }
function duckRows<T>(sql: string): T[] {
  const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial; SET geometry_always_xy=true; ${sql}`], { encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
  const start = output.indexOf('[{'), end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB did not return JSON rows: ${output.slice(0, 300)}`);
  return JSON.parse(output.slice(start, end + 1)) as T[];
}
function coords(value: unknown): XY[] {
  if (!Array.isArray(value)) return [];
  return value.filter((position): position is number[] => Array.isArray(position) && position.length >= 2
      && typeof position[0] === 'number' && typeof position[1] === 'number').map((position) => [position[0]!, position[1]!]);
}
function parts(geometry: Geometry): { parts: XY[][]; polygonRingEnds?: number[] } {
  const c = geometry.coordinates;
  if (geometry.type === 'Point') return { parts: [coords([c])] };
  if (geometry.type === 'MultiPoint' || geometry.type === 'LineString') return { parts: [coords(c)] };
  if (geometry.type === 'MultiLineString') return { parts: (Array.isArray(c) ? c : []).map(coords).filter((part) => part.length > 0) };
  if (geometry.type === 'Polygon') {
    const rings = (Array.isArray(c) ? c : []).map(coords).filter((part) => part.length > 0);
    return { parts: rings, polygonRingEnds: rings.length ? [rings.length] : [] };
  }
  if (geometry.type === 'MultiPolygon') {
    const rings: XY[][] = [], ends: number[] = [];
    for (const polygon of Array.isArray(c) ? c : []) {
      const start = rings.length;
      if (Array.isArray(polygon)) rings.push(...polygon.map(coords).filter((part) => part.length > 0));
      if (rings.length > start) ends.push(rings.length);
    }
    return { parts: rings, polygonRingEnds: ends };
  }
  if (geometry.type === 'GeometryCollection') {
    const combined = (geometry.geometries ?? []).map(parts);
    const flattened = combined.flatMap((item) => item.parts);
    if (combined.some((item) => item.polygonRingEnds)) {
      const ends: number[] = []; let offset = 0;
      for (const item of combined) for (const end of item.polygonRingEnds ?? []) ends.push(offset + end);
      return { parts: flattened, polygonRingEnds: ends };
    }
    return { parts: flattened };
  }
  throw new Error(`Unsupported GeoJSON geometry ${geometry.type}`);
}

const features: OSMFeature[] = [];
const sourceRowCounts: Record<string, number> = {};
const renderedCounts: Record<string, number> = {};
const vertexCounts: Record<string, number> = {};
const envelope = `ST_MakeEnvelope(${BOUNDS_3857.xmin},${BOUNDS_3857.ymin},${BOUNDS_3857.xmax},${BOUNDS_3857.ymax})`;
for (const table of TABLES) {
  const path = quote(`${SOURCE}/${table.file}`);
  const schema = duckRows<{ column_name: string }>(`DESCRIBE SELECT * FROM read_parquet('${path}')`);
  const availableColumns = new Set(schema.map((column) => column.column_name));
  const tagSql = TAG_COLUMNS.filter((tag) => availableColumns.has(tag)).map((tag) => `${tag} := ${tag === 'natural' ? '"natural"' : tag}`).join(', ');
  const geom = table.simplify > 0
    ? `ST_SimplifyPreserveTopology(ST_Intersection(way, ${envelope}), ${table.simplify})`
    : 'way';
  const rows = duckRows<Row>(`
SELECT CAST(osm_id AS VARCHAR) AS id, struct_pack(${tagSql}, tags := tags)::JSON AS properties,
  ST_AsGeoJSON(${geom})::JSON AS geometry
FROM read_parquet('${path}')
WHERE bbox.xmin <= ${BOUNDS_3857.xmax} AND bbox.xmax >= ${BOUNDS_3857.xmin}
  AND bbox.ymin <= ${BOUNDS_3857.ymax} AND bbox.ymax >= ${BOUNDS_3857.ymin}
  AND ST_Intersects(way, ${envelope})
  AND (${table.filter})
ORDER BY osm_id`);
  sourceRowCounts[table.name] = rows.length;
  for (const row of rows) {
    const sourceTags: Record<string, string> = {};
    for (const [key, value] of Object.entries(row.properties)) {
      if (key === 'tags' && value) {
        try {
          const extra: unknown = JSON.parse(value);
          if (extra && typeof extra === 'object' && !Array.isArray(extra)) for (const [tag, tagValue] of Object.entries(extra)) {
            if (typeof tagValue === 'string' || typeof tagValue === 'number' || typeof tagValue === 'boolean') sourceTags[tag] = String(tagValue);
          }
        } catch { throw new Error(`Invalid osm2pgsql tags JSON for ${table.name}/${row.id}`); }
      } else if (typeof value === 'string' && value !== '') sourceTags[key] = value;
    }
    const category = classifyOsmTags(table.name, sourceTags);
    if (!category) throw new Error(`Selected feature has no rendered OSM category: ${table.name}/${row.id}`);
    let geometryType: OSMFeature['geometry']['type'];
    if (table.name === 'planet_osm_point') geometryType = 'point';
    else if (table.name === 'planet_osm_polygon') geometryType = 'polygon';
    else geometryType = 'line';
    const parsedGeometry = parts(row.geometry);
    const geometryParts = parsedGeometry.parts.filter((part) => part.length >= (geometryType === 'point' ? 1 : geometryType === 'line' ? 2 : 4));
    if (!geometryParts.length) continue;
    const polygonRingEnds = geometryType === 'polygon' ? parsedGeometry.polygonRingEnds : undefined;
    features.push({ table: table.name, id: BigInt(row.id), category, geometry: { type: geometryType, parts: geometryParts, ...(polygonRingEnds ? { polygonRingEnds } : {}) }, tags: sourceTags });
    renderedCounts[category] = (renderedCounts[category] ?? 0) + 1;
    vertexCounts[category] = (vertexCounts[category] ?? 0) + geometryParts.reduce((sum, part) => sum + part.length, 0);
  }
}
if (!features.length || renderedCounts.road === undefined || renderedCounts.building === undefined || renderedCounts['public-place'] === undefined) {
  throw new Error(`Unexpected incomplete Shibuya–Yoyogi extract ${JSON.stringify({ sourceRowCounts, renderedCounts })}`);
}
const encoded = encodeOsmFeatures(features);
const stats = {
  source: 'hf:osm-tokyo23-src-2026-08, frozen OpenStreetMap planet extract 2026-08-31',
  sourceUrl: 'https://huggingface.co/datasets/yuiseki/osm-tokyo23-src-2026-08',
  license: 'ODbL 1.0; © OpenStreetMap contributors',
  sourceTablesRows: { planet_osm_point: 306642, planet_osm_line: 347735, planet_osm_polygon: 1437105, planet_osm_roads: 33113 },
  crs: 'EPSG:3857 (WGS 84 / Pseudo-Mercator; metres)',
  extentName: 'Shibuya–Yoyogi rectangular extract (not an official administrative boundary)',
  boundsWgs84: BOUNDS_WGS84,
  boundsEpsg3857: BOUNDS_3857,
  extraction: 'bbox covering intersection, preserving selected osm2pgsql source rows and signed osm_id; intersect with rectangular envelope; topology-preserving simplification at 0.4 m for polygons and 1.2 m for lines; point geometry unchanged; keep non-null source tag columns and extended hstore JSON tags.',
  sourceRowsSelected: sourceRowCounts,
  renderedCategoryFeatures: renderedCounts,
  verticesByCategory: vertexCounts,
  featureCount: features.length,
  uniqueSourceIdsByTable: Object.fromEntries([...new Set(features.map((feature) => feature.table))].map((table) => [table, new Set(features.filter((feature) => feature.table === table).map((feature) => feature.id.toString())).size])),
  vertexCount: features.reduce((sum, feature) => sum + feature.geometry.parts.reduce((count, part) => count + part.length, 0), 0),
  payloadBytes: encoded.byteLength,
  representative: { id: 'relation/19862716', featureRowsMayShareRelationId: true },
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'osm.bin'), encoded);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`OSM map: ${features.length} tagged source rows / ${stats.vertexCount} vertices / ${encoded.byteLength} B`);
console.log(JSON.stringify({ sourceRowCounts, renderedCounts, vertexCounts }));
