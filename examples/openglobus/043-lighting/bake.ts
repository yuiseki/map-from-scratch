// Bakes the three textures of openglobus-043-lighting (run: bin/mfs bake openglobus-043-lighting):
//   earth.jpg   day colour, the Solar System Scope texture of examples/threejs/006-earth (CC BY 4.0)
//   water.png   1 where Natural Earth 10m has ocean or a lake (public domain): the specular mask
//   lights.png  a glow from GeoNames populated places weighted by population (CC BY 4.0).
//               Not satellite night imagery: it shows where people live, drawn as light.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { encodeGrayPng, rasterizePolygons, type LandPolygons } from '../../../tools/land-mask.ts';
import { encodeLights, percentile, splatLights, type Place } from './splat.ts';

const ID = 'openglobus-043-lighting';
const OUT = `data/baked/${ID}`;
const RAW = `data/raw/${ID}`;
const GEONAMES = '/sata_hdd_24tb/hf_data/__published/geonames/data/parquet/20261001/geoname/part-*.parquet';
const NE = '/sata_hdd_24tb/hf_data/__published/natural-earth/data/parquet/v5.1.2';
const DAY = 'examples/threejs/006-earth/earth.jpg';
const DAY_SHA256 = '2faa400d1eade3bc44caf6750d1b772bd9bbb6d87362c02bc7c3304e78fa0a9d';
const W = 2048, H = 1024;

mkdirSync(OUT, { recursive: true });
mkdirSync(RAW, { recursive: true });

// 1. Day texture: the same bytes as threejs-006 (2048 x 1024 equirectangular, lon -180 at the left).
const day = readFileSync(DAY);
const sha = createHash('sha256').update(day).digest('hex');
if (sha !== DAY_SHA256) throw new Error(`${DAY}: sha256 ${sha}, expected ${DAY_SHA256}`);
copyFileSync(DAY, `${OUT}/earth.jpg`);
console.log(`earth.jpg ${day.length} bytes (sha256 ${sha.slice(0, 12)})`);

// 2. Water mask from Natural Earth 10m land and lakes.
const duck = (sql: string) => execFileSync('duckdb', ['-c', sql], { stdio: ['ignore', 'inherit', 'inherit'] });
duck(`load spatial;
copy (select ST_AsGeoJSON(geometry) as g from '${NE}/10m_physical/ne_10m_land.parquet') to '${RAW}/land.csv' (header false, quote '');
copy (select ST_AsGeoJSON(geometry) as g from '${NE}/10m_physical/ne_10m_lakes.parquet') to '${RAW}/lakes.csv' (header false, quote '');`);

type Geo = { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
function polygons(file: string): LandPolygons {
  const out: [number, number][][][] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const g = JSON.parse(line) as Geo;
    const polys = g.type === 'Polygon' ? [g.coordinates as number[][][]] : g.coordinates as number[][][][];
    for (const rings of polys) out.push(rings.map((ring) => ring.map(([lon, lat]) => [(lon + 180) / 360, (90 - lat) / 180] as [number, number])));
  }
  return out;
}
const landPolys = polygons(`${RAW}/land.csv`), lakePolys = polygons(`${RAW}/lakes.csv`);
const land = rasterizePolygons(landPolys, W, H);
const lakes = rasterizePolygons(lakePolys, W, H);
const water = new Uint8Array(W * H);
let waterCount = 0;
for (let i = 0; i < water.length; i++) {
  water[i] = land[i] && !lakes[i] ? 0 : 255;
  if (water[i]) waterCount++;
}
const waterPng = encodeGrayPng(W, H, water);
writeFileSync(`${OUT}/water.png`, waterPng);
console.log(`water.png ${waterPng.length} bytes: ${landPolys.length} land and ${lakePolys.length} lake polygons, water ${(100 * waterCount / water.length).toFixed(1)}% of pixels`);

// 3. Populated places: GeoNames feature class P with a population, without
// sections of places (PPLX, counted in their parent) and historical,
// abandoned or destroyed ones (PPLH, PPLQ, PPLW, PPLCH).
duck(`copy (
  select round(longitude, 4) as lon, round(latitude, 4) as lat, population as pop
  from read_parquet('${GEONAMES}')
  where feature_class = 'P' and population > 0
    and feature_code not in ('PPLX', 'PPLH', 'PPLQ', 'PPLW', 'PPLCH')
  order by population desc
) to '${RAW}/places.csv' (header false);`);
const places: Place[] = [];
for (const line of readFileSync(`${RAW}/places.csv`, 'utf8').split('\n')) {
  if (!line) continue;
  const [lon, lat, pop] = line.split(',').map(Number);
  places.push({ lon, lat, pop });
}
const total = places.reduce((s, p) => s + p.pop, 0);
const acc = splatLights(places, W, H);
// Scale so that the brightest 0.5 % of lit pixels (city cores) are near saturation.
const scale = percentile(acc, 0.995) / 2;
const lights = encodeLights(acc, scale);
let lit = 0;
for (const v of lights) if (v >= 32) lit++;
const lightsPng = encodeGrayPng(W, H, lights);
writeFileSync(`${OUT}/lights.png`, lightsPng);
console.log(`lights.png ${lightsPng.length} bytes: ${places.length} places, ${(total / 1e9).toFixed(2)} billion people, scale ${scale.toFixed(3)}, ${lit} pixels at >= 32`);

// Sanity: Tokyo glows, the middle of the Pacific does not.
const px = (lon: number, lat: number) => lights[Math.floor((90 - lat) / 180 * H) * W + Math.floor((lon + 180) / 360 * W)];
console.log(`lights at Tokyo ${px(139.69, 35.69)}, Cairo ${px(31.24, 30.04)}, Pacific 0N 150W ${px(-150, 0)}`);
console.log(`water at Pacific ${water[Math.floor(90 / 180 * H) * W + Math.floor(30 / 360 * W)]}, Sahara ${water[Math.floor((90 - 23) / 180 * H) * W + Math.floor(180 / 360 * W)]}`);
