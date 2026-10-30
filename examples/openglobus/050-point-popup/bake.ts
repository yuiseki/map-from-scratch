import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
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

// The three labelled points of the OpenGlobus "point" style example.
const points = [
  { name: 'Tokyo', lon: 139.69, lat: 35.69, color: '#38bdf8', text: 'Tokyo, Japan' },
  { name: 'New York', lon: -74.0, lat: 40.71, color: '#f59e0b', text: 'New York, USA' },
  { name: 'London', lon: -0.13, lat: 51.51, color: '#a78bfa', text: 'London, UK' },
].map((p) => ({ ...p, mx: Number(mercX(p.lon).toFixed(6)), my: Number(mercY(p.lat).toFixed(6)) }));

const dir = 'data/baked/openglobus-050-point-popup';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/points.json`, JSON.stringify(points));
console.log(`Baked ${polygons.length} land polygons and ${points.length} points -> ${dir}`);
