import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../../tools/sources.ts';
import { polygonsOf, simplify } from '../../../../tools/geo.ts';
import { projectVintage, unwrapRing, type Coordinate } from './vintage.ts';

interface FeatureCollection { features: { properties: { ADM0_A3: string }; geometry: { type: string; coordinates: unknown } | null }[] }
const OUTPUT = 'data/baked/30DayMapChallenge-2026-06';
const input = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as FeatureCollection;
const countries: { id: string; polygons: Coordinate[][][] }[] = [];
let ringCount = 0, vertexCount = 0;
for (const feature of input.features) {
  if (!feature.geometry) continue;
  const polygons = polygonsOf(feature.geometry).map((polygon) => polygon.map((ring) => {
    const unwrapped = unwrapRing(ring as Coordinate[]);
    const reduced = simplify(unwrapped, 0.16);
    const points = (reduced.length >= 4 ? reduced : unwrapped).map(([lon, lat]) => {
      const [x, y] = projectVintage(lon, lat);
      return [Math.round(x * 65535), Math.round(y * 65535)] as Coordinate;
    });
    ringCount++; vertexCount += points.length;
    return points;
  }).filter((ring) => ring.length >= 4)).filter((polygon) => polygon.length > 0);
  if (polygons.length) countries.push({ id: feature.properties.ADM0_A3, polygons });
}
if (input.features.length !== 258 || countries.length !== 258 || vertexCount < 10000) throw new Error(`Unexpected Natural Earth world geometry ${input.features.length}/${countries.length}/${vertexCount}`);
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/countries.json`, JSON.stringify(countries));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify({ features: input.features.length, countries: countries.length, rings: ringCount, vertices: vertexCount }));
console.log(`Natural Earth: ${countries.length} countries, ${ringCount} rings, ${vertexCount} vertices`);
