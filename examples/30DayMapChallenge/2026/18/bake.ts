import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { source } from '../../../../tools/sources.ts';
import { decodeQuarterMesh, materializeNullCells, type GeographicBounds } from './nullmap.ts';

const output = resolve('data/baked/30DayMapChallenge-2026-18');
const sourcePath = source('estat-census-mesh-250m-2020-jgd2011');
const bounds: GeographicBounds = { west: 139.65, east: 139.78, south: 35.62, north: 35.72 };
const quote = (value: string) => value.replaceAll("'", "''");
const query = `SELECT KEY_CODE, T001142024 FROM read_parquet('${quote(sourcePath)}')
WHERE prefecture='13' AND substr(KEY_CODE,1,4)='5339' ORDER BY KEY_CODE`;
const rawRows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', query], {
  encoding: 'utf8', maxBuffer: 16 << 20,
}).trimEnd().split('\n').filter(Boolean).map((line) => {
  const [code, rawValue] = line.split('|');
  if (!code || rawValue === undefined) throw new Error(`Malformed e-Stat row: ${line}`);
  return { code, rawValue };
});
const rows = rawRows.filter(({ code }) => {
  const cell = decodeQuarterMesh(code);
  return cell.longitude >= bounds.west && cell.longitude <= bounds.east
    && cell.latitude >= bounds.south && cell.latitude <= bounds.north;
});
const cells = materializeNullCells(bounds, rows);
const counts = { missing: 0, suppressed: 0, zero: 0, positive: 0 };
for (const cell of cells) counts[cell.status]++;
const expected = { missing: 224, suppressed: 49, zero: 27, positive: 1716 };
if (JSON.stringify(counts) !== JSON.stringify(expected) || cells.length !== 2016) {
  throw new Error(`Unexpected central Tokyo NULL coverage: ${JSON.stringify({ cells: cells.length, counts })}`);
}
const published = cells.filter((cell) => cell.status === 'positive').map((cell) => cell.value!);
const data = {
  title: '東京・75歳以上女性人口のNULL地図',
  bounds,
  year: 2020,
  meshMeters: 250,
  metric: '75歳以上人口・女性（人）',
  cells,
  legend: {
    missing: '該当メッシュの行なし（人口記録なし）',
    suppressed: '*（秘匿処理・数値非公表）',
    zero: '0人（公表されたゼロ）',
    positive: '1人以上（公表値）',
  },
  attribution: '政府統計の総合窓口(e-Stat)「令和2年国勢調査」(総務省統計局)を加工して作成',
  license: 'CC BY 4.0',
};
mkdirSync(output, { recursive: true });
const json = JSON.stringify(data);
writeFileSync(`${output}/null.json`, json);
writeFileSync(`${output}/stats.json`, JSON.stringify({
  source: '政府統計の総合窓口(e-Stat)「令和2年国勢調査」(総務省統計局)',
  sourceUrl: 'https://www.e-stat.go.jp/help/data-definition-information/downloaddata/T001142.pdf',
  termsUrl: 'https://www.e-stat.go.jp/gis-terms',
  suppressionGuidanceUrl: 'https://www.stat.go.jp/data/mesh/pdf/ryuijikou.pdf',
  license: 'CC BY 4.0-compatible e-Stat terms; attributed and marked as processed',
  table: 'T001142 (JGD2011), prefecture 13',
  field: 'T001142024 (75歳以上人口・女性)',
  bounds,
  meshMeters: 250,
  coordinateReferenceSystem: 'JIS X 0410 quarter mesh; decoded geographic bounds, WGS84-compatible longitude/latitude display',
  modification: '東京の固定AOIに含まれる250 m格子中心を生成。T001142024の文字列をそのまま読み、*を秘匿、0をゼロ、数値を正値として区別。元表にコードがない格子だけを行なしとして追加。',
  counts: { lattice: cells.length, sourceRowsInBounds: rows.length, ...counts },
  positiveValueRange: { min: Math.min(...published), max: Math.max(...published) },
  positivePopulationTotal: published.reduce((sum, value) => sum + value, 0),
  payloadBytes: Buffer.byteLength(json),
  statsVerified: true,
}));
console.log(`Day 18 NULL: ${cells.length} lattice cells; ${JSON.stringify(counts)}; positive range ${Math.min(...published)}–${Math.max(...published)} women`);
