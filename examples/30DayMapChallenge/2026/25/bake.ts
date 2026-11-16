import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { source } from '../../../../tools/sources.ts';
import { simplify } from '../../../../tools/geo.ts';
import { decodeEvents, encodeEvents, type EarthquakeEvent } from './field.ts';

const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-25');
const COMCAT = '/sata_hdd_24tb/hf_data/usgs-earthquake-catalog-2025-m45/data/parquet/earthquakes.parquet';
const COAST_TOLERANCE_DEG = 0.12;
const quote = (value: string) => value.replaceAll("'", "''");

interface ParquetRow {
  event_id: string;
  longitude: number;
  latitude: number;
  mag: number;
  depth_km: number;
  time: number;
}

interface CoastFeature {
  geometry: null | { type: string; coordinates: unknown };
}

interface CoastCollection { features: CoastFeature[] }
type Position = [number, number];

function duckRows<T>(sql: string): T[] {
  const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial; ${sql}`], { encoding: 'utf8', maxBuffer: 16 << 20 }).trim();
  const start = output.indexOf('[{'), end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB did not return JSON rows: ${output.slice(0, 200)}`);
  return JSON.parse(output.slice(start, end + 1)) as T[];
}

function outerRings(geometry: NonNullable<CoastFeature['geometry']>): Position[][] {
  if (geometry.type === 'Polygon') return [(geometry.coordinates as Position[][])[0]!];
  if (geometry.type === 'MultiPolygon') return (geometry.coordinates as Position[][][]).map((polygon) => polygon[0]!);
  return [];
}

/** Break Natural Earth rings at the date line so the flat world view never draws a cross-map chord. */
function splitAtAntimeridian(ring: readonly Position[]): Position[][] {
  const lines: Position[][] = [];
  let part: Position[] = [];
  for (const point of ring) {
    if (part.length && Math.abs(point[0] - part.at(-1)![0]) > 180) {
      if (part.length > 1) lines.push(part);
      part = [];
    }
    part.push(point);
  }
  if (part.length > 1) lines.push(part);
  return lines;
}

const inputRows = duckRows<ParquetRow>(`
SELECT event_id,
  ST_X(geometry) AS longitude, ST_Y(geometry) AS latitude,
  mag, depth_km, time
FROM read_parquet('${quote(COMCAT)}')
WHERE type = 'earthquake' AND net = 'us' AND mag >= 4.5
  AND time >= 1735689600000 AND time <= 1767225599999
ORDER BY time, event_id
`);
const events = decodeEvents(encodeEvents(inputRows.map((row): EarthquakeEvent => ({
  id: row.event_id, longitude: row.longitude, latitude: row.latitude,
  magnitude: row.mag, depthKm: row.depth_km, time: row.time,
}))));
if (events.length !== 8_502 || new Set(events.map((event) => event.id)).size !== 8_502) {
  throw new Error(`Expected exactly 8,502 unique selected ComCat events; got ${events.length}`);
}

const countries = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as CoastCollection;
const rawCoastlines = countries.features.flatMap((feature) => feature.geometry
  ? outerRings(feature.geometry).flatMap(splitAtAntimeridian)
  : []);
const coastlines = rawCoastlines.map((line) => simplify(line, COAST_TOLERANCE_DEG)
  .map(([longitude, latitude]) => [longitude!, latitude!] as Position))
  .filter((line) => line.length > 1);
if (countries.features.length !== 258 || coastlines.length < 100) {
  throw new Error(`Unexpected Natural Earth country context: ${countries.features.length} features, ${coastlines.length} coastline parts`);
}

const eventsBytes = Buffer.from(encodeEvents(events));
const coastBytes = Buffer.from(JSON.stringify(coastlines));
const times = events.map((event) => event.time);
const stats = {
  source: {
    dataset: 'USGS ComCat 2025 M4.5+ preferred-network snapshot',
    url: 'https://huggingface.co/datasets/yuiseki/usgs-comcat-2025-m45',
    file: COMCAT,
    format: 'GeoParquet 1.0.0',
    crs: 'OGC:CRS84 (2D longitude, latitude)',
    license: 'U.S. public domain; attribution requested: U.S. Geological Survey, ComCat',
    snapshotRetrieved: '2026-10-25T09:29:29.667943+00:00',
    filter: { type: 'earthquake', preferredNetwork: 'us', magnitudeMinimum: 4.5, startInclusive: '2025-01-01T00:00:00Z', endInclusive: '2025-12-31T23:59:59.999Z' },
    fields: ['event_id', 'longitude', 'latitude', 'mag', 'depth_km', 'time'],
    count: events.length,
    uniqueIds: new Set(events.map((event) => event.id)).size,
    eventIdSha256: createHash('sha256').update(events.map((event) => event.id).sort().join('\n')).digest('hex'),
    firstTime: Math.min(...times),
    lastTime: Math.max(...times),
    magnitudeRange: [Math.min(...events.map((event) => event.magnitude)), Math.max(...events.map((event) => event.magnitude))],
    depthRangeKm: [Math.min(...events.map((event) => event.depthKm)), Math.max(...events.map((event) => event.depthKm))],
  },
  context: {
    source: 'Natural Earth v5.1.1 admin-0 countries, 1:10m',
    license: 'Public domain',
    sourceFile: '/sata_hdd_24tb/hf_data/__published/ne-admin0-10m/v5.1.1/shapefile/ne_10m_admin_0_countries.shp',
    features: countries.features.length,
    sourceExteriorParts: rawCoastlines.length,
    simplificationToleranceDegrees: COAST_TOLERANCE_DEG,
    antimeridianSplitCoastlineParts: coastlines.length,
  },
  output: {
    events: events.length, eventBytes: eventsBytes.byteLength, coastlineParts: coastlines.length,
    coastlineVertices: coastlines.reduce((sum, line) => sum + line.length, 0), coastlineBytes: coastBytes.byteLength,
  },
  interpretation: 'Concentric afterimage rings are artistic symbols only. They do not represent physical wave propagation, shaking, impact footprints or hazard contours.',
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'events.json'), eventsBytes);
writeFileSync(resolve(OUTPUT, 'coastlines.json'), coastBytes);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Day 25: ${events.length} exact ComCat records; ${coastlines.length} Natural Earth coastline parts; ${eventsBytes.byteLength + coastBytes.byteLength} payload bytes`);
