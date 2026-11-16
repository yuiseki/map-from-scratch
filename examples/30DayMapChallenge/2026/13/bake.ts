import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { source } from '../../../../tools/sources.ts';
import { encodeMobilityFrame, flowOffset, type Municipality } from './mobility.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-13';
const meshPath = source('mlit-attribute-mesh1km-2022-01');
const masterPath = source('mlit-city-master-2022-01');
const flowPath = source('mlit-fromto-city-2022-01');
const quote = (path: string) => path.replaceAll("'", "''");
const years = [2019, 2020, 2021];

const locationRows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', `
  WITH mesh_centres AS (
    SELECT citycode, avg(try_cast(lon_center AS DOUBLE)) AS lon, avg(try_cast(lat_center AS DOUBLE)) AS lat
    FROM read_parquet('${quote(meshPath)}') WHERE version = '2020'
    GROUP BY citycode
  )
  SELECT m.citycode, m.cityname, m.prefname, c.lon, c.lat
  FROM read_parquet('${quote(masterPath)}') m JOIN mesh_centres c USING (citycode)
  WHERE m.version = '2020' ORDER BY m.citycode
`], { encoding: 'utf8', maxBuffer: 16 << 20 }).trimEnd();
const municipalities: Municipality[] = locationRows.split('\n').filter(Boolean).map((line) => {
  const [code, name, prefecture, lon, lat] = line.split('|');
  const result = { code: code!, name: name!, prefecture: prefecture!, lon: Number(lon), lat: Number(lat) };
  if (!/^[0-9]{5}$/.test(result.code) || !result.name || !result.prefecture || !Number.isFinite(result.lon) || !Number.isFinite(result.lat)) throw new Error(`Invalid MLIT municipality centre: ${line}`);
  return result;
});
if (municipalities.length < 1500) throw new Error(`Expected nationwide municipal coverage, got ${municipalities.length}`);
const cityIndex = new Map(municipalities.map((city, index) => [city.code, index]));
const frames = new Map<string, Uint32Array>();
for (const year of years) for (let month = 0; month < 12; month++) frames.set(`${year}-${String(month + 1).padStart(2, '0')}`, new Uint32Array(municipalities.length * 3 * 3 * 4));

const rows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', `
  SELECT year, month, dayflag, timezone, citycode,
    sum(population) FILTER (WHERE from_area = '0'),
    sum(population) FILTER (WHERE from_area = '1'),
    sum(population) FILTER (WHERE from_area = '2'),
    sum(population) FILTER (WHERE from_area = '3')
  FROM read_parquet('${quote(flowPath)}')
  WHERE year BETWEEN '2019' AND '2021'
  GROUP BY year, month, dayflag, timezone, citycode
  ORDER BY year, month, dayflag, timezone, citycode
`], { encoding: 'utf8', maxBuffer: 256 << 20 }).trimEnd();
let groupedRecords = 0, missingLocations = 0;
for (const row of rows.split('\n').filter(Boolean)) {
  const [yearText, monthText, dayText, timeText, cityCode, ...values] = row.split('|');
  const year = Number(yearText), month = Number(monthText) - 1, day = Number(dayText), time = Number(timeText);
  const city = cityIndex.get(cityCode!);
  if (city === undefined) { missingLocations++; continue; }
  if (!frames.has(`${year}-${String(month + 1).padStart(2, '0')}`) || day < 0 || day > 2 || time < 0 || time > 2 || values.length !== 4) throw new Error(`Invalid MLIT aggregated origin record: ${row}`);
  const categories = values.map((v) => v === '' || v === 'NULL' ? 0 : Number(v));
  if (categories.some((v) => !Number.isSafeInteger(v) || v < 0 || v > 0xffffffff)) throw new Error(`Invalid population total: ${row}`);
  const key = `${year}-${String(month + 1).padStart(2, '0')}`;
  const index = frames.get(key)!;
  for (let area = 0; area < 4; area++) index[flowOffset(city, day, time, area)] = categories[area]!;
  groupedRecords++;
}
if (groupedRecords < 500_000 || missingLocations > 250) throw new Error(`Unexpected MLIT flow coverage: ${groupedRecords} groups, ${missingLocations} without mesh-centre locations`);

const collection = JSON.parse(readFileSync(source('ne-japan-prefectures'), 'utf8')) as { features: unknown[] };
if (collection.features.length < 40) throw new Error(`Expected Japan prefecture outlines, got ${collection.features.length}`);
mkdirSync(`${OUTPUT}/frames`, { recursive: true });
const monthlyBytes: Record<string, number> = {};
for (const [key, flows] of frames) {
  const [year, monthText] = key.split('-');
  const raw = encodeMobilityFrame({ year: Number(year), month: Number(monthText) - 1, municipalityCount: municipalities.length, flows });
  const compressed = gzipSync(new Uint8Array(raw), { level: 9 });
  monthlyBytes[key] = compressed.byteLength;
  writeFileSync(`${OUTPUT}/frames/${key}.bin.gz`, compressed);
}
const tai = cityIndex.get('13106');
const taiToi = tai === undefined ? null : [0, 1, 2, 3].map((area) => frames.get('2021-11')![flowOffset(tai, 2, 0, area)]);
if (!taiToi || taiToi.every((value) => value === 0)) throw new Error('Expected Taito-ku values for November 2021, all-days, daytime');
const totalBytes = Object.values(monthlyBytes).reduce((a, b) => a + b, 0);
const municipalityJson = JSON.stringify(municipalities);
const prefectureJson = JSON.stringify(collection);
const stats = {
  sourceVintage: '2022-01', years, municipalityCount: municipalities.length, prefectureCount: collection.features.length,
  groupedRecords, missingLocationRecords: missingLocations, totalGzipBytes: totalBytes,
  maxMonthGzipBytes: Math.max(...Object.values(monthlyBytes)), monthlyBytes,
  sizeAccounting: {
    totalGzipBytes: 'sum of the 36 already-gzip-compressed frames/*.bin.gz files; gzip level 9; excludes JSON metadata',
    municipalityJsonGzipBytes: gzipSync(municipalityJson, { level: 9 }).byteLength,
    prefectureJsonGzipBytes: gzipSync(prefectureJson, { level: 9 }).byteLength,
    shippedFootprint: 'The browser benchmark data_gzip_bytes gate is the sum of each shipped data asset compressed individually by the harness, including metadata JSON. It is not the on-disk frame gzip sum above; stats.json itself is included by that harness measurement.',
  },
  sample: { code: '13106', year: 2021, month: 11, dayflag: 'all days', timezone: 'daytime', categories: taiToi },
  suppressed: 'MLIT omits values under 10; absent published category values are displayed as missing, not as zero.',
  centroids: 'mesh-centre mean by municipality; not an official boundary centroid',
};
writeFileSync(`${OUTPUT}/municipalities.json`, municipalityJson);
writeFileSync(`${OUTPUT}/prefectures.json`, prefectureJson);
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`MLIT interactions: ${municipalities.length} municipality mesh centres, ${collection.features.length} prefectures, ${groupedRecords} month/day/time groups, ${missingLocations} groups omitted for no matching 2020 mesh-centre position; ${totalBytes} B total gzip, ${stats.maxMonthGzipBytes} B largest month`);
