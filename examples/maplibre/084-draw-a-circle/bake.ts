import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number) => (lon + 180) / 360;

// MapLibre "Draw a circle": centre [-74.5, 40], 50 km radius.
const CENTER: [number, number] = [-74.5, 40];
const RADIUS_M = 50000;
const M_PER_DEG = 111320;

const ring: number[][] = [];
const latRad = (CENTER[1] * Math.PI) / 180;
for (let i = 0; i <= 128; i++) {
  const angle = (i / 128) * Math.PI * 2;
  const lat = CENTER[1] + (Math.sin(angle) * RADIUS_M) / M_PER_DEG;
  const lon = CENTER[0] + (Math.cos(angle) * RADIUS_M) / (M_PER_DEG * Math.cos(latRad));
  ring.push([Number(mercX(lon).toFixed(6)), Number(mercY(lat).toFixed(6))]);
}

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    polygons.push(shape.map((r) => r.map(([lon, lat]) => [
      Number(mercX(lon).toFixed(5)),
      Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(5)),
    ])));
  }
}

const dir = 'data/baked/maplibre-084-draw-a-circle';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/circle.json`, JSON.stringify({ center: CENTER, radiusM: RADIUS_M, ring }));
console.log(`circle of ${RADIUS_M} m with ${ring.length - 1} segments -> ${dir}/circle.json`);
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${dir}/land.json`);
