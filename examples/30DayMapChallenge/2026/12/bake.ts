import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { equalEarth, polygonsOf } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';
import { encodeCountryGeometry, simplifyRing } from './geometry.ts';
import { encodeAccessSeries } from './power.ts';

interface FeatureCollection {
  features: { properties: { ADM0_A3: string; NAME: string; LABEL_X: number; LABEL_Y: number }; geometry: { type: string; coordinates: unknown } | null }[];
}
interface EncodedCountry { iso3: string; name: string; label: [number, number]; rings: [number, number][][] }
const OUTPUT = 'data/baked/30DayMapChallenge-2026-12';
const START_YEAR = 1990, END_YEAR = 2024, YEAR_COUNT = END_YEAR - START_YEAR + 1;
const X = 2.7066, Y = 1.3174, TOLERANCE = (2 * X / 1280) * 0.35;
const normalize = ([x, y]: Point): [number, number] => [
  Math.max(0, Math.min(1, (x + X) / (2 * X))),
  Math.max(0, Math.min(1, (Y - y) / (2 * Y))),
];

const wdiFile = source('worldbank-wdi-2026-10-01-data');
const query = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', `
  SELECT country_code, year, value
  FROM read_parquet('${wdiFile}')
  WHERE indicator_code = 'EG.ELC.ACCS.ZS'
    AND year BETWEEN ${START_YEAR} AND ${END_YEAR}
    AND value IS NOT NULL
  ORDER BY country_code, year
`], { encoding: 'utf8', maxBuffer: 16 << 20 }).trimEnd();
const series = new Map<string, (number | null)[]>();
for (const row of query.split('\n').filter(Boolean)) {
  const [iso3, yearText, valueText] = row.split('|');
  const year = Number(yearText), value = Number(valueText);
  if (!iso3 || !/^[A-Z]{3}$/.test(iso3) || !Number.isInteger(year) || year < START_YEAR || year > END_YEAR
    || !Number.isFinite(value) || value < 0 || value > 100) throw new Error(`Invalid WDI electricity-access row: ${row}`);
  const values = series.get(iso3) ?? Array<number | null>(YEAR_COUNT).fill(null);
  const index = year - START_YEAR;
  if (values[index] !== null) throw new Error(`Duplicate WDI row for ${iso3}, ${year}`);
  values[index] = value;
  series.set(iso3, values);
}
if (!series.has('JPN') || (series.get('USA')?.[END_YEAR - START_YEAR] ?? null) !== 100) {
  throw new Error('WDI electricity-access data is missing expected Japan or United States values');
}

const collection = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as FeatureCollection;
if (collection.features.length !== 258) throw new Error(`Expected 258 Natural Earth countries, got ${collection.features.length}`);
const countries: EncodedCountry[] = [];
const accessRecords: { iso3: string; values: (number | null)[] }[] = [];
let polygonCount = 0, ringCount = 0, pointCount = 0;
const countryCodes = new Set<string>();
for (const feature of collection.features) {
  if (!feature.geometry) continue;
  const iso3 = feature.properties.ADM0_A3;
  if (!/^[A-Z]{3}$/.test(iso3) || countryCodes.has(iso3)) throw new Error(`Invalid or duplicate Natural Earth code: ${iso3}`);
  countryCodes.add(iso3);
  const rings: [number, number][][] = [];
  for (const polygon of polygonsOf(feature.geometry)) {
    let hasOuter = false;
    for (const ring of polygon) {
      const points = simplifyRing(ring, TOLERANCE, equalEarth).map(normalize);
      if (points.length < 3) continue;
      if (!hasOuter) { hasOuter = true; polygonCount++; }
      rings.push(points); pointCount += points.length; ringCount++;
    }
  }
  if (!rings.length) continue;
  const labelCoordinates = [feature.properties.LABEL_X, feature.properties.LABEL_Y].map(Number);
  const label = labelCoordinates.every(Number.isFinite)
    ? normalize(equalEarth([labelCoordinates[0]!, labelCoordinates[1]!]))
    : rings[0]![Math.floor(rings[0]!.length / 2)]!;
  countries.push({ iso3, name: feature.properties.NAME, label, rings });
  accessRecords.push({ iso3, values: series.get(iso3) ?? Array<number | null>(YEAR_COUNT).fill(null) });
}
if (countries.length < 250 || countries.length !== accessRecords.length) throw new Error(`Unexpected rendered country count: ${countries.length}`);
const access = encodeAccessSeries(accessRecords, START_YEAR);
const geometry = encodeCountryGeometry(countries);
const joinedByYear = Array.from({ length: YEAR_COUNT }, (_, offset) => accessRecords.filter((record) => record.values[offset] !== null).length);
if (joinedByYear[2024 - START_YEAR] !== 212 || joinedByYear[1990 - START_YEAR] < 80) {
  throw new Error(`Unexpected Natural Earth/WDI join coverage: 1990=${joinedByYear[0]}, 2024=${joinedByYear.at(-1)}`);
}
const stats = {
  sourceDate: '2026-10-01', indicator: 'EG.ELC.ACCS.ZS', startYear: START_YEAR, endYear: END_YEAR,
  sourceCountryCount: series.size, renderedCountryCount: countries.length, joinedByYear,
  polygonCount, ringCount, pointCount: geometry.pointCount, geometryBytes: geometry.buffer.byteLength, accessBytes: access.byteLength,
  attribution: 'The World Bank: World Development Indicators: World Population Prospects, United Nations (UN); Statistical databases and publications from national statistical offices (NSOs); Eurostat: Demographic Statistics; Population and Vital Statistics Report, UN Statistics Division. The World Bank does not endorse this copy.',
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/countries.json`, JSON.stringify(geometry.metadata));
writeFileSync(`${OUTPUT}/geometry.bin`, new Uint8Array(geometry.buffer));
writeFileSync(`${OUTPUT}/access.bin`, new Uint8Array(access));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`WDI electricity access: ${countries.length} Natural Earth countries, ${joinedByYear[0]} joined in 1990, ${joinedByYear.at(-1)} in 2024, ${polygonCount} polygons, ${geometry.pointCount} vertices, ${(geometry.buffer.byteLength / 1024).toFixed(1)} KiB geometry`);
