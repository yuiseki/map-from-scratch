import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeSmellData, type Position } from './smell.ts';

const ROOT = resolve('.');
const OUTPUT = resolve(ROOT, 'data/baked/30DayMapChallenge-2026-19');
const POLYGON = '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/parquet/planet_osm_polygon.parquet';
const ROADS = '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/parquet/planet_osm_roads.parquet';
const LINES = '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/parquet/planet_osm_line.parquet';
const BOUNDS = { west: 139.64, east: 139.86, south: 35.58, north: 35.72 };
const WEB_MERCATOR_BOUNDS = { west: 15_542_000, east: 15_568_000, south: 4_243_000, north: 4_264_000 };
const quote = (path: string) => path.replaceAll("'", "''");

function duckRows<T>(sql: string): T[] {
  const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial; SET geometry_always_xy=true; ${sql}`], {
    encoding: 'utf8', maxBuffer: 64 << 20,
  }).trim();
  const jsonStart = output.indexOf('[{');
  const jsonEnd = output.lastIndexOf(']');
  if (jsonStart < 0 || jsonEnd < jsonStart) throw new Error(`DuckDB did not return a JSON row array: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(jsonStart, jsonEnd + 1)) as T[];
}

interface GeometryRow { id: number; name?: string | null; lon?: number; lat?: number; tags?: string | null; highway?: string | null; waterway?: string | null; geometry: { type: string; coordinates: unknown } }

function lines(geometry: GeometryRow['geometry']): Position[][] {
  if (geometry.type === 'LineString') return [geometry.coordinates as Position[]];
  if (geometry.type === 'MultiLineString') return geometry.coordinates as Position[][];
  if (geometry.type === 'GeometryCollection') return [];
  throw new Error(`Unexpected line geometry ${geometry.type}`);
}

function outerRings(geometry: GeometryRow['geometry']): Position[][] {
  if (geometry.type === 'Polygon') return [(geometry.coordinates as Position[][])[0]!];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Position[][][]).map((polygon) => polygon[0]!);
  throw new Error(`Unexpected facility geometry ${geometry.type}`);
}

const sourceRows = duckRows<GeometryRow>(`
SELECT osm_id AS id, name, tags,
  ST_X(ST_Transform(ST_Centroid(way), 'EPSG:3857', 'EPSG:4326')) AS lon,
  ST_Y(ST_Transform(ST_Centroid(way), 'EPSG:3857', 'EPSG:4326')) AS lat,
  ST_AsGeoJSON(ST_Transform(ST_Simplify(way, 8), 'EPSG:3857', 'EPSG:4326'))::JSON AS geometry
FROM read_parquet('${quote(POLYGON)}')
WHERE osm_id = 23690250
`);
if (sourceRows.length !== 1 || sourceRows[0]!.name !== '芝浦水再生センター') {
  throw new Error(`Expected exactly one frozen OSM feature way/23690250 named 芝浦水再生センター; got ${sourceRows.length} rows`);
}
const sourceRow = sourceRows[0]!;
const outline = outerRings(sourceRow.geometry);
const source = {
  id: `way/${sourceRow.id}`,
  name: sourceRow.name,
  lon: sourceRow.lon!,
  lat: sourceRow.lat!,
  kind: 'wastewater_reclamation_candidate',
  outline,
};

const roadRows = duckRows<GeometryRow>(`
SELECT osm_id AS id, highway,
  ST_AsGeoJSON(ST_Transform(ST_Simplify(ST_Intersection(way,
    ST_MakeEnvelope(${WEB_MERCATOR_BOUNDS.west},${WEB_MERCATOR_BOUNDS.south},${WEB_MERCATOR_BOUNDS.east},${WEB_MERCATOR_BOUNDS.north})), 22), 'EPSG:3857', 'EPSG:4326'))::JSON AS geometry
FROM read_parquet('${quote(ROADS)}')
WHERE bbox.xmin < ${WEB_MERCATOR_BOUNDS.east} AND bbox.xmax > ${WEB_MERCATOR_BOUNDS.west}
  AND bbox.ymin < ${WEB_MERCATOR_BOUNDS.north} AND bbox.ymax > ${WEB_MERCATOR_BOUNDS.south}
  AND highway IN ('motorway','motorway_link','trunk','trunk_link','primary','primary_link','secondary','secondary_link','tertiary')
`);

const waterwayRows = duckRows<GeometryRow>(`
SELECT osm_id AS id, waterway,
  ST_AsGeoJSON(ST_Transform(ST_Simplify(ST_Intersection(way,
    ST_MakeEnvelope(${WEB_MERCATOR_BOUNDS.west},${WEB_MERCATOR_BOUNDS.south},${WEB_MERCATOR_BOUNDS.east},${WEB_MERCATOR_BOUNDS.north})), 12), 'EPSG:3857', 'EPSG:4326'))::JSON AS geometry
FROM read_parquet('${quote(LINES)}')
WHERE bbox.xmin < ${WEB_MERCATOR_BOUNDS.east} AND bbox.xmax > ${WEB_MERCATOR_BOUNDS.west}
  AND bbox.ymin < ${WEB_MERCATOR_BOUNDS.north} AND bbox.ymax > ${WEB_MERCATOR_BOUNDS.south}
  AND waterway IN ('river','canal','stream','drain')
`);

const data = decodeSmellData({
  observation: {
    station: '東京', stationLon: 139.75, stationLat: 35.69,
    observedAt: '2026-11-04T18:00:00+09:00', fromDegrees: 337.5, fromLabel: '北北西', speedMps: 1.9,
    sourceUrl: 'https://www.data.jma.go.jp/stats/etrn/view/hourly_s1.php?prec_no=44&block_no=47662&year=2026&month=11&day=04&view=',
  },
  sources: [source],
  roads: roadRows.flatMap((row) => lines(row.geometry)).filter((line) => line.length >= 2),
  waterways: waterwayRows.flatMap((row) => lines(row.geometry)).filter((line) => line.length >= 2),
  bounds: BOUNDS,
  plume: { lengthM: 5000, spreadRatio: 0.12, sourceHalfWidthM: 250 },
});

const payload = Buffer.from(JSON.stringify(data));
const stats = {
  source: 'OpenStreetMap Tokyo 23 wards snapshot 2026-08-31; JMA Tokyo hourly wind observation 2026-11-04 18:00 JST',
  osmSourceUrl: 'https://www.openstreetmap.org/way/23690250',
  osmLicense: 'ODbL-1.0; © OpenStreetMap contributors',
  osmCrs: 'EPSG:3857 source transformed to WGS84 longitude/latitude',
  facility: { id: source.id, name: source.name, lon: source.lon, lat: source.lat, kind: source.kind, outlineRings: source.outline.length },
  jma: { station: 'Tokyo', stationLon: 139.75, stationLat: 35.69, observedAt: '2026-11-04T18:00:00+09:00', from: '北北西', fromDegrees: 337.5, speedMps: 1.9 },
  bounds: BOUNDS,
  roads: { features: roadRows.length, lines: data.roads.length, vertices: data.roads.reduce((sum, line) => sum + line.length, 0) },
  waterways: { features: waterwayRows.length, lines: data.waterways.length, vertices: data.waterways.reduce((sum, line) => sum + line.length, 0) },
  plume: { lengthM: data.plume.lengthM, halfWidthAtOriginM: data.plume.sourceHalfWidthM, halfWidthAtEndM: data.plume.sourceHalfWidthM + data.plume.spreadRatio * data.plume.lengthM },
  payloadBytes: payload.byteLength,
  interpretation: 'Illustrative downwind fan, not an odor measurement or concentration model. No source emissions, atmospheric stability, turbulence, topography or building flow are modeled.',
};
if (data.roads.length === 0 || data.waterways.length === 0 || source.outline.length === 0) {
  throw new Error(`Unexpected missing context geometry: ${JSON.stringify(stats)}`);
}
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'smell.json'), payload);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Smell map: 1 candidate, ${stats.roads.lines} road lines / ${stats.waterways.lines} waterways, ${payload.byteLength} B`);
