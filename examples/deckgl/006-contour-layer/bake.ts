import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

interface County {
  longitude: number; latitude: number; population: number;
  casesByWeek: Record<string, number>;
}
const input = JSON.parse(readFileSync(source('deckgl-contour-covid'), 'utf8')) as County[];
const counties = input.filter((c) => Number.isFinite(c.longitude) && Number.isFinite(c.latitude)
  && Math.abs(c.latitude) < 85.051129 && Number.isFinite(c.population) && c.population > 0);
const WEEK_COUNT = 87;
const RATE_LIMIT = 12000;
const stride = 8 + Math.ceil(WEEK_COUNT / 2) * 3;
const out = Buffer.alloc(16 + counties.length * stride);
out.write('CT01', 0, 'ascii');
out.writeUInt32LE(counties.length, 4);
out.writeUInt32LE(WEEK_COUNT, 8);
out.writeFloatLE(RATE_LIMIT, 12);
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
let high = 0;
for (let i = 0; i < counties.length; i++) {
  const c = counties[i], at = 16 + i * stride;
  out.writeFloatLE((c.longitude + 180) / 360, at);
  out.writeFloatLE(mercY(c.latitude), at + 4);
  for (let week = 0; week < WEEK_COUNT; week += 2) {
    const rate = Math.max(0, (c.casesByWeek[String(week)] ?? 0) / c.population * 100000);
    high = Math.max(high, rate);
    const nextRate = week + 1 < WEEK_COUNT
      ? Math.max(0, (c.casesByWeek[String(week + 1)] ?? 0) / c.population * 100000) : 0;
    high = Math.max(high, nextRate);
    const a = Math.round(Math.log1p(Math.min(RATE_LIMIT, rate)) / Math.log1p(RATE_LIMIT) * 4095);
    const b = Math.round(Math.log1p(Math.min(RATE_LIMIT, nextRate)) / Math.log1p(RATE_LIMIT) * 4095);
    const dest = at + 8 + Math.floor(week / 2) * 3;
    out[dest] = a & 255;
    out[dest + 1] = (a >> 8) | ((b & 15) << 4);
    out[dest + 2] = b >> 4;
  }
}
if (high > RATE_LIMIT) throw new Error(`rate ${high} exceeds ${RATE_LIMIT}; raise RATE_LIMIT to avoid clipping`);
const dir = 'data/baked/deckgl-006-contour-layer';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/counties.bin`, out);
console.log(`${counties.length} counties, weeks 0-${WEEK_COUNT - 1}, max rate ${high.toFixed(1)}, ${out.length} B`);

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
    Number(((lon + 180) / 360).toFixed(7)),
    Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(7)),
  ])));
}
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`${polygons.length} Natural Earth land polygons`);
