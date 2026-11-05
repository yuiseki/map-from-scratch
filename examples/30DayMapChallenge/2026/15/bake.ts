import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../../tools/sources.ts';
import type { ProfileData, ProfileEvent } from './profile.ts';

const output = 'data/baked/30DayMapChallenge-2026-15';
const west = 143, east = 146, latitude = 42.25, halfWidth = 0.25;
const gebcoFile = source('gebco-hokkaido-east-2026').replaceAll("'", "''");
const sql = `LOAD spatial; SELECT round(ST_X(ST_Centroid(geometry)), 8), elevation_m FROM read_parquet('${gebcoFile}') WHERE ST_Y(ST_Centroid(geometry)) BETWEEN ${latitude + 0.001} AND ${latitude + 0.004} ORDER BY ST_X(ST_Centroid(geometry))`;
const lines = execFileSync('duckdb', ['-noheader', '-list', '-separator', '\t', '-c', sql], { encoding: 'utf8', maxBuffer: 16 << 20 })
  .trimEnd().split('\n').filter(Boolean);
if (lines.length !== 720) throw new Error(`Expected 720 GEBCO cells along the transect, got ${lines.length}`);
const elevations: number[] = [];
for (let i = 0; i < lines.length; i++) {
  const [lonText, elevationText] = lines[i]!.split('\t');
  const lon = Number(lonText), elevation = Number(elevationText);
  if (!Number.isFinite(lon) || !Number.isFinite(elevation) || (i > 0 && lon <= Number(lines[i - 1]!.split('\t')[0]))) throw new Error(`Invalid GEBCO row ${i}`);
  elevations.push(elevation);
}

const quakeFile = source('usgs-quakes-2025');
const collection = JSON.parse(readFileSync(quakeFile, 'utf8')) as { features: { id: string; geometry: { coordinates: number[] }; properties: { mag: number } }[] };
const events: ProfileEvent[] = collection.features.flatMap((feature) => {
  const [lon, lat, depthKm] = feature.geometry.coordinates;
  if (lon === undefined || lat === undefined || depthKm === undefined || lon < west || lon > east || Math.abs(lat - latitude) > halfWidth || depthKm < 0) return [];
  return [{ lon, depthKm, magnitude: feature.properties.mag, id: feature.id }];
}).sort((a, b) => a.lon - b.lon);
const profile: ProfileData = { west, east, latitude, elevations, events };
const stats = {
  source: 'GEBCO_2026 Grid; 15 arc-second sample at 42.25°N; 143°–146°E', sourceCells: elevations.length,
  elevationMinM: Math.min(...elevations), elevationMaxM: Math.max(...elevations),
  usgsSource: 'USGS ComCat 2025 M4.5+ preferred-network snapshot', eventCount: events.length,
  eventLatitudeSlab: [latitude - halfWidth, latitude + halfWidth], eventDepthMinKm: Math.min(...events.map((event) => event.depthKm), 0),
  eventDepthMaxKm: Math.max(...events.map((event) => event.depthKm), 0),
  transectDistanceKm: (east - west) * 111.32 * Math.cos(latitude * Math.PI / 180),
  outputBytes: Buffer.byteLength(JSON.stringify(profile)),
};
if (stats.elevationMinM > -1000 || stats.elevationMaxM < 500 || events.length < 1) throw new Error(`Unexpected section coverage: ${JSON.stringify(stats)}`);
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/profile.json`, JSON.stringify(profile));
writeFileSync(`${output}/stats.json`, JSON.stringify(stats));
console.log(`GEBCO cells ${elevations.length}; elevation ${stats.elevationMinM}…${stats.elevationMaxM} m; USGS hypocenters ${events.length}; ${stats.outputBytes} B`);
