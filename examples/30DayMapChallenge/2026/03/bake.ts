import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { equalEarth, polygonsOf, simplify, triangulatePolygon } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';
import { encodeCountryMesh, populationClass } from './polygons.ts';

interface FeatureCollection {
  features: { properties: { ADM0_A3: string }; geometry: { type: string; coordinates: unknown } | null }[];
}
const OUTPUT = 'data/baked/30DayMapChallenge-2026-03';
const X = 2.7066, Y = 1.3174, TOLERANCE = (2 * X / 1280) * 0.4;
const quantize = ([x, y]: Point): [number, number] => [
  Math.max(0, Math.min(65535, Math.round(((x + X) / (2 * X)) * 65535))),
  Math.max(0, Math.min(65535, Math.round(((Y - y) / (2 * Y)) * 65535))),
];

const input = source('worldbank-wdi-basic-annual');
const csv = execFileSync('duckdb', ['-noheader', '-csv', '-c', `
  SELECT iso3,value FROM read_parquet('${input}')
  WHERE indicator='SP.POP.TOTL' AND year=2024 AND value IS NOT NULL ORDER BY iso3
`], { encoding: 'utf8', maxBuffer: 2 << 20 }).trimEnd();
const populations = new Map<string, number>();
for (const line of csv.split('\n')) {
  const [iso3, value] = line.split(',');
  if (!iso3 || !Number.isFinite(Number(value)) || Number(value) <= 0 || populations.has(iso3)) throw new Error(`Invalid WDI population row: ${line}`);
  populations.set(iso3, Number(value));
}
if (populations.size !== 217) throw new Error(`Unexpected 2024 WDI population coverage: ${populations.size} rows`);

const data = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as FeatureCollection;
const geometries = data.features.filter((feature) => feature.geometry !== null);
const geometryCodes = new Set(geometries.map((feature) => feature.properties.ADM0_A3));
const joined = [...populations.entries()].filter(([code]) => geometryCodes.has(code));
if (data.features.length !== 258 || joined.length !== 213) throw new Error(`Unexpected WDI/Natural Earth join: ${joined.length} of ${populations.size}; ${data.features.length} features`);
const values = joined.map(([, value]) => value);
const minimum = Math.min(...values), maximum = Math.max(...values);
const colorClasses = new Set(values.map((value) => populationClass(value, minimum, maximum))).size;
const vertices: [number, number, number][] = [];
const triangles: number[] = [];
const borders: [number, number][] = [];
let countriesWithValues = 0, countriesWithoutValues = 0, polygons = 0;

for (const feature of geometries) {
  const value = populations.get(feature.properties.ADM0_A3) ?? null;
  const colorClass = populationClass(value, minimum, maximum);
  if (value === null) countriesWithoutValues++;
  else countriesWithValues++;
  for (const polygon of polygonsOf(feature.geometry)) {
    const rings = polygon.map((ring) => {
      const points = simplify(ring.map(equalEarth), TOLERANCE).map(quantize);
      if (points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop();
      return points;
    }).filter((ring) => ring.length >= 3);
    if (!rings[0]) continue;
    const mesh = triangulatePolygon(rings);
    if (mesh.vertices.length < 6 || mesh.indices.length < 3) continue;
    const base = vertices.length;
    for (let i = 0; i < mesh.vertices.length; i += 2) vertices.push([mesh.vertices[i], mesh.vertices[i + 1], colorClass]);
    triangles.push(...mesh.indices.map((index) => base + index));
    let ringStart = base;
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) borders.push([ringStart + i, ringStart + ((i + 1) % ring.length)]);
      ringStart += ring.length;
    }
    polygons++;
  }
}
const buffer = encodeCountryMesh({ vertices, triangles, borders });
const unmatchedCodes = [...populations.keys()].filter((code) => !geometryCodes.has(code)).sort();
if (unmatchedCodes.join(',') !== 'CHI,PSE,SSD,XKX' || countriesWithValues !== 213) throw new Error(`Unexpected WDI join omissions: ${unmatchedCodes.join(',')}`);

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/countries.bin`, new Uint8Array(buffer));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify({
  year: 2024, indicator: 'SP.POP.TOTL', populationRows: populations.size, countriesWithValues,
  countriesWithoutValues, unmatchedCodes, polygonFeatures: data.features.length, polygons,
  vertices: vertices.length, triangles: triangles.length / 3, borderSegments: borders.length, colorClasses,
  minimum, maximum,
}));
console.log(`WDI 2024: ${countriesWithValues}/${populations.size} codes joined; ${polygons} polygons, ${vertices.length} vertices, ${triangles.length / 3} triangles, ${borders.length} borders, ${buffer.byteLength} bytes`);
