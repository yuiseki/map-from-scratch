import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

// 1. Bake land polygons
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

// 2. Bake Bay Area highway lines
interface RoadFeature {
  geometry: {
    type: string;
    coordinates: any;
  };
}

const roads = JSON.parse(readFileSync(source('deckgl-highway-roads'), 'utf8')) as { features: RoadFeature[] };
const highwayLines: number[][][] = [];

for (const f of roads.features) {
  const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const seg of coords) {
    if (Array.isArray(seg) && Array.isArray(seg[0])) {
      const pts = seg as [number, number][];
      if (pts.some(([lon, lat]) => lon > -123.5 && lon < -121.0 && lat > 37.0 && lat < 38.8)) {
        highwayLines.push(pts.map(([lon, lat]) => [
          Number(mercX(lon).toFixed(6)),
          Number(mercY(lat).toFixed(6)),
        ]));
      }
    }
  }
}

const dir = 'data/baked/tangram-004-highways-demo';
mkdirSync(dir, { recursive: true });

writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/highways.json`, JSON.stringify(highwayLines));
console.log(`Baked ${polygons.length} land polygons and ${highwayLines.length} highway lines -> ${dir}`);
