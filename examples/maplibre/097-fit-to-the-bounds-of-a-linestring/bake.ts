import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const mercX = (lon: number) => (lon + 180) / 360;

// MapLibre "Fit to the bounds of a LineString": a short walk in downtown
// Washington, DC (11 points from the official example).
const RAW_ROUTE: [number, number][] = [
  [-77.0366048812866, 38.89873175227713],
  [-77.03364372253417, 38.89876515143842],
  [-77.03364372253417, 38.89549195896866],
  [-77.02982425689697, 38.89549195896866],
  [-77.02400922775269, 38.89387200688839],
  [-77.01519012451172, 38.891416957534204],
  [-77.01521158218382, 38.892068305429156],
  [-77.00813055038452, 38.892051604275686],
  [-77.00832366943358, 38.89143365883688],
  [-77.00818419456482, 38.89082405874451],
  [-77.00815200805664, 38.88989712255097],
];

const routeMercator = RAW_ROUTE.map(([lon, lat]) => [
  Number(mercX(lon).toFixed(8)),
  Number(mercY(lat).toFixed(8)),
]);

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

const dir = 'data/baked/maplibre-097-fit-to-the-bounds-of-a-linestring';
mkdirSync(dir, { recursive: true });

const routePath = `${dir}/route.json`;
writeFileSync(routePath, JSON.stringify(routeMercator));
console.log(`${routeMercator.length} line coordinates -> ${routePath}`);

const landPath = `${dir}/land.json`;
writeFileSync(landPath, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${landPath}`);
