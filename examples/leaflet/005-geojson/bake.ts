import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as {
  features: { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } }[];
};
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

// Illustrative features on the same intent as the Leaflet GeoJSON tutorial:
// named points, a route and a region polygon, each carrying a property that a
// popup shows. Coordinates are real places; the route is not a real itinerary.
const features = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'London' }, geometry: { type: 'Point', coordinates: [-0.1278, 51.5074] } },
    { type: 'Feature', properties: { name: 'Paris' }, geometry: { type: 'Point', coordinates: [2.3522, 48.8566] } },
    { type: 'Feature', properties: { name: 'Berlin' }, geometry: { type: 'Point', coordinates: [13.405, 52.52] } },
    { type: 'Feature', properties: { name: 'Madrid' }, geometry: { type: 'Point', coordinates: [-3.7038, 40.4168] } },
    { type: 'Feature', properties: { name: 'Rome' }, geometry: { type: 'Point', coordinates: [12.4964, 41.9028] } },
    {
      type: 'Feature',
      properties: { name: 'Route London-Paris-Berlin' },
      geometry: { type: 'LineString', coordinates: [[-0.1278, 51.5074], [2.3522, 48.8566], [13.405, 52.52]] },
    },
    {
      type: 'Feature',
      properties: { name: 'Central Europe' },
      geometry: { type: 'Polygon', coordinates: [[[2, 46], [16, 46], [16, 54], [2, 54], [2, 46]]] },
    },
  ],
};

const dir = 'data/baked/leaflet-005-geojson';
mkdirSync(dir, { recursive: true });

writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/features.json`, JSON.stringify(features));
console.log(`${polygons.length} land polygons, ${features.features.length} features -> ${dir}`);
