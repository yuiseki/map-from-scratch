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

// A box over Brazil; the palette recolours this overlay together with the sea
// and land beneath it.
const box: number[][] = [[-70, -20], [-50, -20], [-50, 5], [-70, 5], [-70, -20]].map(([lon, lat]) => [
  Number(mercX(lon).toFixed(5)),
  Number(mercY(lat).toFixed(5)),
]);

const dir = 'data/baked/mapbox-038-color-switcher';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/box.json`, JSON.stringify(box));
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`box ${box.length} points, ${polygons.length} land polygons -> ${dir}`);
