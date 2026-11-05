import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sourcePath = process.env.DAY22_PARQUET
  ?? '/sata_hdd_24tb/hf_data/__published/natural-earth/data/parquet/v5.1.2/110m_cultural/ne_110m_admin_0_countries.parquet';
const outputDir = resolve('data/baked/30DayMapChallenge-2026-22');
const quote = (value: string) => value.replaceAll("'", "''");
interface RawFeature { adm0_a3: string; name: string; geometry: { type: string; coordinates: unknown } }
const result = execFileSync('duckdb', ['-json', '-c', `LOAD spatial;
SELECT ADM0_A3 AS adm0_a3, NAME AS name, ST_AsGeoJSON(geometry)::JSON AS geometry
FROM read_parquet('${quote(sourcePath)}') ORDER BY ADM0_A3`], {
  encoding: 'utf8', maxBuffer: 32 << 20,
});
const start = result.indexOf('[{');
const end = result.lastIndexOf(']');
if (start < 0 || end < start) throw new Error(`DuckDB returned no country rows: ${result.slice(0, 300)}`);
const features = JSON.parse(result.slice(start, end + 1)) as RawFeature[];
const geometryTypes: Record<string, number> = {};
let vertices = 0;
for (const feature of features) {
  if (!feature.adm0_a3 || !feature.name || !['Polygon', 'MultiPolygon'].includes(feature.geometry.type)) {
    throw new Error(`Unexpected Natural Earth feature: ${JSON.stringify(feature).slice(0, 200)}`);
  }
  geometryTypes[feature.geometry.type] = (geometryTypes[feature.geometry.type] ?? 0) + 1;
  const count = (value: unknown): number => Array.isArray(value)
    ? (value.length === 2 && value.every((v) => typeof v === 'number') ? 1 : value.reduce((n, child) => n + count(child), 0)) : 0;
  vertices += count(feature.geometry.coordinates);
}
if (features.length !== 177 || geometryTypes.Polygon !== 148 || geometryTypes.MultiPolygon !== 29) {
  throw new Error(`Unexpected Natural Earth 110m layer profile: ${JSON.stringify({ features: features.length, geometryTypes })}`);
}
const payload = JSON.stringify({ source: 'Natural Earth 1:110m Admin 0 Countries', features });
const stats = {
  source: 'Natural Earth v5.1.2 collection; ne_110m_admin_0_countries layer v5.1.1',
  sourceUrl: 'https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/',
  localSourcePath: sourcePath,
  sourceLayer: 'ne_110m_admin_0_countries',
  sourceFileBytes: 231079,
  license: 'Public domain; attribution optional (Made with Natural Earth)',
  sourceCrs: 'EPSG:4326 (WGS 84 longitude/latitude)',
  features: features.length,
  geometryTypes,
  vertices,
  processing: 'Selected ADM0_A3, NAME and geometry; preserved all 177 geometries and coordinates without filtering, simplifying, repairing or changing CRS; sorted by ADM0_A3 and serialized as deterministic JSON. Projection is applied at render time to this single frozen geometry set.',
  payloadBytes: Buffer.byteLength(payload),
};
mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'countries.json'), payload);
writeFileSync(resolve(outputDir, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
console.log(`Natural Earth 110m countries: ${features.length} features, ${vertices} source vertices, ${Buffer.byteLength(payload)} B JSON`);
