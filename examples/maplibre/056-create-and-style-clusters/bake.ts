import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

interface Feature {
  geometry: { type: string; coordinates: number[] };
  properties: { mag: number | null; tsunami: number };
}
const data = JSON.parse(readFileSync(source('maplibre-cluster-earthquakes'), 'utf8')) as { features: Feature[] };
const valid = data.features.filter((f) => f.geometry.type === 'Point'
  && Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])
  && Math.abs(f.geometry.coordinates[1]) < 85.051129);
const out = Buffer.alloc(16 + valid.length * 16);
out.write('EQ01', 0, 'ascii');
out.writeUInt32LE(valid.length, 4);
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
for (let i = 0; i < valid.length; i++) {
  const f = valid[i], at = 16 + i * 16;
  out.writeFloatLE((f.geometry.coordinates[0] + 180) / 360, at);
  out.writeFloatLE(mercY(f.geometry.coordinates[1]), at + 4);
  out.writeFloatLE(f.properties.mag ?? NaN, at + 8);
  out.writeUInt32LE(f.properties.tsunami === 1 ? 1 : 0, at + 12);
}
const path = 'data/baked/maplibre-056-create-and-style-clusters/earthquakes.bin';
mkdirSync('data/baked/maplibre-056-create-and-style-clusters', { recursive: true });
writeFileSync(path, out);
console.log(`${valid.length} earthquakes, ${out.length} bytes -> ${path}`);

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
    Number(((lon + 180) / 360).toFixed(7)),
    Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(7)),
  ])));
}
const landPath = 'data/baked/maplibre-056-create-and-style-clusters/land.json';
writeFileSync(landPath, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${landPath}`);
