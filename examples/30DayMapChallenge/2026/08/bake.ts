import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { decodeQuarterMesh, scoreNeighborhood, type AccessFeature } from './utopia.ts';

const output = 'data/baked/30DayMapChallenge-2026-08';
const center: [number, number] = [139.6535, 35.7378]; // Nerima Station
const bounds = { minLon: 139.615, maxLon: 139.692, minLat: 35.706, maxLat: 35.770 };
const meshPath = source('estat-census-mesh-250m-2020-jgd2011');
const parkPath = source('mlit-toshi-keikaku-parks-2025');
const schoolPath = source('ksj-p29-schools-tokyo-2023');

function query(sql: string): string[] {
  return execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', sql], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd().split('\n').filter(Boolean);
}
function parseGeometry(text: string): AccessFeature['geometry'] {
  const value = JSON.parse(text) as AccessFeature['geometry'];
  if (!['Point', 'Polygon', 'MultiPolygon'].includes(value.type)) throw new Error(`Unexpected access geometry: ${value.type}`);
  return value;
}

const parks = query(`LOAD spatial; SELECT ParkName, ST_AsGeoJSON(ST_SimplifyPreserveTopology(ST_Intersection(geometry, ST_MakeEnvelope(${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat})),0.00001)) FROM read_parquet('${parkPath}') WHERE Citycode='13120' AND ParkType='公園' AND ST_Intersects(geometry,ST_MakeEnvelope(${bounds.minLon},${bounds.minLat},${bounds.maxLon},${bounds.maxLat}))`)
  .map((line) => {
    const [name, geometry] = line.split('|');
    if (!name || !geometry) throw new Error(`Malformed park record: ${line.slice(0, 100)}`);
    return { name, geometry: parseGeometry(geometry) };
  }).filter((park) => park.geometry.type !== 'Point');
const schools = query(`LOAD spatial; SELECT P29_004, ST_AsGeoJSON(geometry) FROM read_parquet('${schoolPath}') WHERE P29_001='13120'`)
  .map((line) => {
    const [name, geometry] = line.split('|');
    if (!geometry) throw new Error(`Malformed school record: ${line.slice(0, 100)}`);
    return { name: name ?? '学校', geometry: parseGeometry(geometry) };
  }).filter((school): school is { name: string; geometry: Extract<AccessFeature['geometry'], { type: 'Point' }> } => school.geometry.type === 'Point')
  .filter((school) => school.geometry.coordinates[0] >= bounds.minLon - 0.01 && school.geometry.coordinates[0] <= bounds.maxLon + 0.01
    && school.geometry.coordinates[1] >= bounds.minLat - 0.01 && school.geometry.coordinates[1] <= bounds.maxLat + 0.01);
const access: AccessFeature[] = [
  ...parks.map(({ geometry }) => ({ kind: 'park' as const, geometry })),
  ...schools.map(({ geometry }) => ({ kind: 'school' as const, geometry })),
];

const meshRows = query(`SELECT KEY_CODE, T001142001 FROM read_parquet('${meshPath}') WHERE prefecture='13'`);
const cells = meshRows.flatMap((line) => {
  const [code, rawPopulation] = line.split('|');
  if (!code || !rawPopulation) return [];
  const mesh = decodeQuarterMesh(code);
  if (mesh.longitude < bounds.minLon || mesh.longitude > bounds.maxLon || mesh.latitude < bounds.minLat || mesh.latitude > bounds.maxLat) return [];
  const population = Number(rawPopulation);
  if (!Number.isFinite(population)) return [];
  const accessScore = scoreNeighborhood([mesh.longitude, mesh.latitude], access);
  return [{ ...mesh, code, population, parkMeters: accessScore.nearestParkMeters, schoolMeters: accessScore.nearestSchoolMeters,
    walkableToPark: accessScore.walkableToPark, walkableToSchool: accessScore.walkableToSchool }];
});
if (cells.length < 200 || parks.length < 20 || schools.length < 20) {
  throw new Error(`Unexpected Nerima coverage: ${cells.length} meshes, ${parks.length} parks, ${schools.length} schools`);
}
const data = { center, bounds, walkMeters: 400, cells, parks: parks.map(({ name, geometry }) => ({ name, geometry })),
  schools: schools.map(({ name, geometry }) => ({ name, geometry })),
  attribution: { census: '政府統計の総合窓口(e-Stat)「令和2年国勢調査」(総務省統計局)を加工して作成',
    parks: '出典：「都市計画決定GISデータ」（国土交通省）を加工して作成', schools: '出典: 国土数値情報 (学校データ) (国土交通省)' } };
mkdirSync(output, { recursive: true });
writeFileSync(`${output}/utopia.json`, JSON.stringify(data));
writeFileSync(`${output}/stats.json`, JSON.stringify({ cells: cells.length, parks: parks.length, schools: schools.length,
  bothWithinWalk: cells.filter((cell) => cell.walkableToPark && cell.walkableToSchool).length,
  population: cells.reduce((sum, cell) => sum + cell.population, 0), walkMeters: 400, center, bounds }));
console.log(`Nerima Utopia: ${cells.length} 250 m meshes, ${parks.length} parks, ${schools.length} schools; ${cells.filter((cell) => cell.walkableToPark && cell.walkableToSchool).length} meshes within 400 m of both`);
