import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

interface Feature {
  geometry: { type: string; coordinates: number[] };
  properties: { mag: number | null };
}

const data = JSON.parse(readFileSync(source('maplibre-cluster-earthquakes'), 'utf8')) as { features: Feature[] };
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const valid = data.features.filter((f) => f.geometry.type === 'Point'
  && Number.isFinite(f.geometry.coordinates[0]) && Number.isFinite(f.geometry.coordinates[1])
  && Number.isFinite(f.properties.mag)
  && Math.abs(f.geometry.coordinates[1]) < 85.051129);

// 12 bytes per quake: mercator x, mercator y, magnitude.
const out = Buffer.alloc(8 + valid.length * 12);
out.write('DDC1', 0, 'ascii');
out.writeUInt32LE(valid.length, 4);
let minMag = Infinity;
let maxMag = -Infinity;
for (let i = 0; i < valid.length; i++) {
  const f = valid[i];
  const at = 8 + i * 12;
  const mag = f.properties.mag as number;
  minMag = Math.min(minMag, mag);
  maxMag = Math.max(maxMag, mag);
  out.writeFloatLE((f.geometry.coordinates[0] + 180) / 360, at);
  out.writeFloatLE(mercY(f.geometry.coordinates[1]), at + 4);
  out.writeFloatLE(mag, at + 8);
}

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];
for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
    Number(((lon + 180) / 360).toFixed(5)),
    Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(5)),
  ])));
}

const dir = 'data/baked/mapbox-045-data-driven-circle-colors';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/quakes.bin`, out);
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
console.log(`${valid.length} quakes (mag ${minMag.toFixed(2)}-${maxMag.toFixed(2)}), ${out.length} bytes + ${polygons.length} land polygons -> ${dir}`);
