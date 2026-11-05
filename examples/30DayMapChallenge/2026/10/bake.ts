import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { polygonsOf, simplify } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';
import { encodeAirports, type Airport } from './airports.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-10';
const X_EXTENT = 2.7066, Y_EXTENT = 1.3174;
const TOLERANCE = 0.0008;
interface Country { geometry: { type: string; coordinates: unknown } | null }

function project(lon: number, lat: number): Point {
  const rad = Math.PI / 180;
  const theta = Math.asin((Math.sqrt(3) / 2) * Math.sin(lat * rad));
  const t2 = theta * theta, t6 = t2 * t2 * t2;
  const polynomial = 1.340264 - 0.081106 * t2 + 0.000893 * t6 + 0.003796 * t6 * t2;
  const x = (2 * Math.sqrt(3) * lon * rad * Math.cos(theta)) / (3 * polynomial);
  const y = theta * polynomial;
  return [x / (2 * X_EXTENT) + 0.5, 0.5 - y / (2 * Y_EXTENT)];
}

const countryData = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as { features: Country[] };
const land: Point[][] = [];
let landVertices = 0;
for (const feature of countryData.features) {
  if (!feature.geometry) continue;
  for (const polygon of polygonsOf(feature.geometry)) {
    const outer = polygon[0];
    if (!outer) continue;
    const ring = simplify(outer.map(([lon, lat]) => project(lon, lat)), TOLERANCE);
    if (ring.length < 4) continue;
    land.push(ring);
    landVertices += ring.length;
  }
}
if (land.length < 200 || landVertices < 10_000) throw new Error(`Unexpected Natural Earth geometry: ${land.length} rings / ${landVertices} points`);

const airportsPath = source('ourairports-2026-08');
const sql = `SELECT type, longitude_deg, latitude_deg, scheduled_service
FROM read_parquet('${airportsPath}')
WHERE type IN ('large_airport','medium_airport','small_airport','seaplane_base','heliport','balloonport')
  AND longitude_deg BETWEEN -180 AND 180 AND latitude_deg BETWEEN -90 AND 90
  AND longitude_deg IS NOT NULL AND latitude_deg IS NOT NULL
ORDER BY CASE type WHEN 'balloonport' THEN 5 WHEN 'heliport' THEN 4 WHEN 'seaplane_base' THEN 3 WHEN 'small_airport' THEN 2 WHEN 'medium_airport' THEN 1 ELSE 0 END`;
const rows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', sql], { encoding: 'utf8', maxBuffer: 16 << 20 }).trimEnd().split('\n').filter(Boolean);
const airports: Airport[] = rows.map((row) => {
  const [type, lonText, latText, scheduledService] = row.split('|');
  const lon = Number(lonText), lat = Number(latText);
  if (!type || !Number.isFinite(lon + lat) || !['yes', 'no'].includes(scheduledService ?? '')) throw new Error(`Malformed OurAirports row: ${row}`);
  return { lon, lat, type, scheduled: scheduledService === 'yes' };
});
if (airports.length < 50_000) throw new Error(`Unexpected active airport count: ${airports.length}`);

const counts = { large_airport: 0, medium_airport: 0, small_airport: 0, seaplane_base: 0, heliport: 0, balloonport: 0 };
for (const airport of airports) counts[airport.type as keyof typeof counts]++;
const landJson = JSON.stringify(land);
const airportBuffer = encodeAirports(airports);
const stats = {
  source: 'OurAirports snapshot 2026-08-31 (commit 9e51f13487de777bdc473a37d271981a2d0b30ca)',
  sourceAirportRows: 86_002,
  renderedAirports: airports.length,
  scheduledServiceAirports: airports.filter((airport) => airport.scheduled).length,
  excludedClosedOrUnlocated: 86_002 - airports.length,
  byType: counts,
  landSource: 'Natural Earth 10m Admin 0 v5.1.1, public domain',
  landRings: land.length,
  landVertices,
  airportRecordBytes: 6,
  landBytes: Buffer.byteLength(landJson),
  airportBytes: airportBuffer.byteLength,
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/land.json`, landJson);
writeFileSync(`${OUTPUT}/airports.bin`, new Uint8Array(airportBuffer));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`OurAirports: ${airports.length} active located sites (${stats.scheduledServiceAirports} scheduled), ${land.length} land rings / ${landVertices} vertices; ${airportBuffer.byteLength} airport bytes, ${Buffer.byteLength(landJson)} land bytes`);
