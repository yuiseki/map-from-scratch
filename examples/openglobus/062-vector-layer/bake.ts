import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';
import earcut from '../../../vendor/earcut/earcut.js';

const OUT_DIR = 'data/baked/openglobus-062-vector-layer';
mkdirSync(OUT_DIR, { recursive: true });

type Ring = [number, number][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: [number, number][][][] = [];

for (const feature of land.features) {
  const shapes =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Ring[]]
      : (feature.geometry.coordinates as Ring[][]);

  for (const shape of shapes) {
    polygons.push(
      shape.map((ring) =>
        ring.map(([lon, lat]) => [
          Number(lon.toFixed(2)),
          Number(lat.toFixed(2)),
        ])
      )
    );
  }
}

// Fill triangles (lon, lat x 100, Int16): rings filled with hidden vertices
// skipped cut the land at the rim; the renderer splits these and pins them
// to the rim. Rings at 2 decimals (about 1 km, finer than 110m) keep the
// two files under the data budget.
const verts: number[] = [];
for (const shape of polygons) {
  const flat: number[] = [], holes: number[] = [];
  shape.forEach((ring, r) => { if (r > 0) holes.push(flat.length / 2); for (const [lon, lat] of ring) flat.push(lon, lat); });
  for (const i of earcut(flat, holes)) verts.push(Math.round(flat[i * 2] * 100), Math.round(flat[i * 2 + 1] * 100));
}
writeFileSync(`${OUT_DIR}/land.bin`, Buffer.from(new Int16Array(verts).buffer));
writeFileSync(`${OUT_DIR}/countries.json`, JSON.stringify(polygons));
console.log(`Baked ${polygons.length} country polygons -> ${OUT_DIR}/countries.json`);
