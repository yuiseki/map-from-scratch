import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number) => (lon + 180) / 360;

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
      Number(mercX(lon).toFixed(5)),
      Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(5)),
    ])));
  }
}

// Ground circles as in the OpenGlobus example: a centre and a metric radius.
const M_PER_DEG = 111320;
const circles = [
  { name: 'Tokyo', lon: 139.69, lat: 35.69, radiusM: 1500000, color: '#38bdf8' },
  { name: 'New York', lon: -74.0, lat: 40.71, radiusM: 1200000, color: '#f59e0b' },
  { name: 'London', lon: -0.13, lat: 51.51, radiusM: 1000000, color: '#a78bfa' },
].map((c) => {
  const rad = (c.lat * Math.PI) / 180;
  const ring: number[][] = [];
  for (let i = 0; i <= 128; i++) {
    const a = (i / 128) * Math.PI * 2;
    const lat = c.lat + (Math.sin(a) * c.radiusM) / M_PER_DEG;
    const lon = c.lon + (Math.cos(a) * c.radiusM) / (M_PER_DEG * Math.cos(rad));
    ring.push([Number(mercX(lon).toFixed(6)), Number(mercY(lat).toFixed(6))]);
  }
  return { ...c, ring };
});

const dir = 'data/baked/openglobus-009-circles-on-the-ground';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/circles.json`, JSON.stringify(circles));
console.log(`Baked ${polygons.length} land polygons and ${circles.length} ground circles -> ${dir}`);
