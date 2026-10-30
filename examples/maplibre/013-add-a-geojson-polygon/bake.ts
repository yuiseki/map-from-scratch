import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

// Maine state polygon from MapLibre official example
const RAW_MAINE_RING: [number, number][] = [
  [-67.13734351262877, 45.137451890638886],
  [-66.96466, 44.8097],
  [-68.03252, 44.3252],
  [-69.06, 43.98],
  [-70.11617, 43.68405],
  [-70.64573401557249, 43.090083319667144],
  [-70.75102474636725, 43.08003225358635],
  [-70.79761105007827, 43.21973948828747],
  [-70.98176001655037, 43.36789581966826],
  [-70.94416541205806, 43.46633942318431],
  [-71.08482, 45.3052400000002],
  [-70.6600225491012, 45.46022288673396],
  [-70.30495378282376, 45.914794623389355],
  [-70.00014034695016, 46.69317088478567],
  [-69.23708614772835, 47.44777598732787],
  [-68.90478084987546, 47.184794623394396],
  [-68.23430497910454, 47.35462921812177],
  [-67.79035274928509, 47.066248887716995],
  [-67.79141211614706, 45.702585354182816],
  [-67.13734351262877, 45.137451890638886],
];

const maineMercator = RAW_MAINE_RING.map(([lon, lat]) => [
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

const dir = 'data/baked/maplibre-013-add-a-geojson-polygon';
mkdirSync(dir, { recursive: true });

const mainePath = `${dir}/maine.json`;
writeFileSync(mainePath, JSON.stringify(maineMercator));
console.log(`${maineMercator.length} maine coordinates -> ${mainePath}`);

const landPath = `${dir}/land.json`;
writeFileSync(landPath, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${landPath}`);
