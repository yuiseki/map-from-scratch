import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { source } from '../../../../tools/sources.ts';
import { sharedMaximum, validatePresenceMap, type PresenceMap } from './lightdark.ts';

const ROOT = resolve('.');
const OUTPUT = resolve(ROOT, 'data/baked/30DayMapChallenge-2026-17');
const meshPath = source('mlit-mesh1km-2022-01');
const attrPath = source('mlit-attribute-mesh1km-2022-01');
const quote = (path: string) => path.replaceAll("'", "''");
const BOUNDS = { west: 139.55, east: 139.98, south: 35.53, north: 35.82 };
const YEAR = 2021, MONTH = '12';

const query = `
WITH geometry AS (
  SELECT mesh1kmid, try_cast(lon_min AS DOUBLE) AS west, try_cast(lon_max AS DOUBLE) AS east,
    try_cast(lat_min AS DOUBLE) AS south, try_cast(lat_max AS DOUBLE) AS north,
    try_cast(lon_center AS DOUBLE) AS lon, try_cast(lat_center AS DOUBLE) AS lat
  FROM read_parquet('${quote(attrPath)}')
  WHERE version = '2020' AND try_cast(lon_center AS DOUBLE) >= ${BOUNDS.west} AND try_cast(lon_center AS DOUBLE) < ${BOUNDS.east}
    AND try_cast(lat_center AS DOUBLE) >= ${BOUNDS.south} AND try_cast(lat_center AS DOUBLE) < ${BOUNDS.north}
), presence AS (
  SELECT mesh1kmid, timezone, sum(population) AS population
  FROM read_parquet('${quote(meshPath)}')
  WHERE prefcode = '13' AND year = '${YEAR}' AND month = '${MONTH}' AND dayflag = '2' AND timezone IN ('0', '1')
  GROUP BY mesh1kmid, timezone
)
SELECT g.mesh1kmid, g.west, g.east, g.south, g.north,
  max(p.population) FILTER (WHERE p.timezone = '0') AS daytime,
  max(p.population) FILTER (WHERE p.timezone = '1') AS late_night
FROM geometry g LEFT JOIN presence p USING (mesh1kmid)
GROUP BY g.mesh1kmid, g.west, g.east, g.south, g.north
ORDER BY g.mesh1kmid
`;

const rows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', query], { encoding: 'utf8', maxBuffer: 8 << 20 }).trimEnd();
const meshes = rows.split('\n').filter(Boolean).map((row) => {
  const [id, west, east, south, north, daytime, lateNight] = row.split('|');
  const mesh = {
    id: id!, west: Number(west), east: Number(east), south: Number(south), north: Number(north),
    daytime: daytime === 'NULL' || daytime === '' ? null : Number(daytime),
    lateNight: lateNight === 'NULL' || lateNight === '' ? null : Number(lateNight),
  };
  if (!mesh.id || Object.values(mesh).some((value) => typeof value === 'number' && !Number.isFinite(value))) throw new Error(`Invalid MLIT mesh row: ${row}`);
  return mesh;
});
const map: PresenceMap = { bounds: BOUNDS, year: YEAR, month: 12, dayflag: '2', maximum: 0, meshes };
map.maximum = sharedMaximum(map);
validatePresenceMap(map);
if (map.meshes.length !== 1016 || map.meshes.filter((mesh) => mesh.daytime !== null).length !== 682 || map.meshes.filter((mesh) => mesh.lateNight !== null).length !== 671) {
  throw new Error(`Unexpected MLIT coverage: ${map.meshes.length} geometry cells, ${map.meshes.filter((mesh) => mesh.daytime !== null).length} day, ${map.meshes.filter((mesh) => mesh.lateNight !== null).length} night`);
}
const totals = map.meshes.reduce((sum, mesh) => ({
  daytime: sum.daytime + (mesh.daytime ?? 0), lateNight: sum.lateNight + (mesh.lateNight ?? 0),
}), { daytime: 0, lateNight: 0 });
if (totals.daytime !== 11_951_622 || totals.lateNight !== 10_198_442 || map.maximum !== 190_197) throw new Error(`Unexpected MLIT population totals: ${JSON.stringify({ totals, max: map.maximum })}`);
const payload = {
  ...map,
  units: 'monthly average number of people present per 1 km mesh; values under 10 are suppressed and absent records are unknown, not zero',
  timezoneMeaning: { daytime: '11:00–14:00', lateNight: '01:00–04:00' },
};
const dataBytes = Buffer.from(JSON.stringify(payload));
const stats = {
  source: '全国の人流オープンデータ（国土交通省）',
  sourceUrl: 'https://www.geospatial.jp/ckan/dataset/mlit-1km-fromto',
  sourceVintage: '2022-01 snapshot; records cover 2019-01 through 2021-12',
  license: 'Government of Japan Standard Terms of Use 2.0 (equivalent to CC BY 4.0)',
  attribution: '出典：「全国の人流オープンデータ」（国土交通省）（https://www.geospatial.jp/ckan/dataset/mlit-1km-fromto）を加工して作成',
  modification: 'Selected Tokyo prefecture 13, 2021-12, all days (dayflag=2), times 0/1, and 2020 WGS84 1 km mesh centres inside the half-open AOI bounds; summed values by mesh id.',
  coordinateReferenceSystem: 'WGS84 longitude/latitude',
  units: payload.units,
  bounds: BOUNDS,
  year: YEAR,
  month: 12,
  dayflag: '2 (all days)',
  daytimeTimezone: '0 (11:00–14:00)',
  lateNightTimezone: '1 (01:00–04:00)',
  geometryCount: meshes.length,
  daytimeRecords: meshes.filter((mesh) => mesh.daytime !== null).length,
  lateNightRecords: meshes.filter((mesh) => mesh.lateNight !== null).length,
  daytimeSuppressedOrAbsent: meshes.filter((mesh) => mesh.daytime === null).length,
  lateNightSuppressedOrAbsent: meshes.filter((mesh) => mesh.lateNight === null).length,
  daytimePopulationTotal: totals.daytime,
  lateNightPopulationTotal: totals.lateNight,
  sharedMaximum: map.maximum,
  payloadBytes: dataBytes.byteLength,
  limitation: 'Presence counts are monthly daily averages of published estimates, not observed illumination or night-light imagery. Counts below 10 are suppressed; absent cells are not zero. The data does not identify individuals or movement between cells.',
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'presence.json'), dataBytes);
writeFileSync(resolve(OUTPUT, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
console.log(`MLIT presence: ${meshes.length} 1 km mesh geometries; ${stats.daytimeRecords} day / ${stats.lateNightRecords} night records; max ${map.maximum}; ${dataBytes.byteLength} B`);
