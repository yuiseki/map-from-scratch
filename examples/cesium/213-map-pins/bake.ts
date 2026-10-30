import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';
import earcut from '../../../vendor/earcut/earcut.js';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const verts: number[] = [];

for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];

  for (const poly of shapes) {
    const flat: number[] = [];
    const holeIndices: number[] = [];
    for (let r = 0; r < poly.length; r++) {
      if (r > 0) holeIndices.push(flat.length / 2);
      for (const [lon, lat] of poly[r]) {
        flat.push(lon, lat);
      }
    }

    const indices = earcut(flat, holeIndices);
    for (let i = 0; i < indices.length; i++) {
      const idx = indices[i];
      const lon = flat[idx * 2];
      const lat = flat[idx * 2 + 1];
      verts.push(
        Math.round(lon * 100),
        Math.round(lat * 100),
      );
    }
  }
}

const pins = [
  { name: 'London', lon: -0.1276, lat: 51.5074, color: '#4caf50' },     // Green pin
  { name: 'Washington', lon: -77.0369, lat: 38.9072, color: '#03a9f4' }, // Cyan pin
  { name: 'Tokyo', lon: 139.6917, lat: 35.6895, color: '#f44336' },     // Red pin
];

const dir = 'data/baked/cesium-213-map-pins';
mkdirSync(dir, { recursive: true });

const i16 = new Int16Array(verts);
writeFileSync(`${dir}/land.bin`, Buffer.from(i16.buffer));
writeFileSync(`${dir}/pins.json`, JSON.stringify(pins));
console.log(`Baked ${verts.length / 6} triangles and ${pins.length} pins to ${dir}`);
