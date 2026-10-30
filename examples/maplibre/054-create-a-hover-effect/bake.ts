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

// A box over Ethiopia; hovering it changes the polygon's fill colour.
const box: number[][] = [[30, 0], [45, 0], [45, 15], [30, 15], [30, 0]].map(([lon, lat]) => [
  Number(mercX(lon).toFixed(5)),
  Number(mercY(lat).toFixed(5)),
]);

const dir = 'data/baked/maplibre-054-create-a-hover-effect';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/box.json`, JSON.stringify(box));
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`box ${box.length} points, ${polygons.length} land polygons -> ${dir}`);
