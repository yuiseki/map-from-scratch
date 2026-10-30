import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

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

const billboards = [
  { name: 'Cairo', lon: 31.2357, lat: 30.0444, color: '#e91e63' },
  { name: 'Paris', lon: 2.3522, lat: 48.8566, color: '#3f51b5' },
  { name: 'Tokyo', lon: 139.6917, lat: 35.6895, color: '#ff9800' },
  { name: 'New York', lon: -74.006, lat: 40.7128, color: '#009688' },
  { name: 'Sydney', lon: 151.2093, lat: -33.8688, color: '#9c27b0' },
];

const dir = 'data/baked/openglobus-004-billboards';
mkdirSync(dir, { recursive: true });

writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/billboards.json`, JSON.stringify(billboards));
console.log(`Baked land and ${billboards.length} billboards -> ${dir}`);
