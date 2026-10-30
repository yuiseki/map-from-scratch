import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';
import earcut from '../../../vendor/earcut/earcut.js';

const OUT_DIR = 'data/baked/cesium-209-lighting';
mkdirSync(OUT_DIR, { recursive: true });

// Natural Earth 110m land as earcut triangles (lon, lat x 100, Int16). The
// split to short edges happens at load time (see toSphere in globe.ts): baking
// it would multiply the file size, as measured for cesium-180.
type Ring = [number, number][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const verts: number[] = [];

for (const feature of land.features) {
  const shapes =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Ring[]]
      : (feature.geometry.coordinates as Ring[][]);
  for (const shape of shapes) {
    const flat: number[] = [];
    const holes: number[] = [];
    shape.forEach((ring, r) => {
      if (r > 0) holes.push(flat.length / 2);
      for (const [lon, lat] of ring) flat.push(lon, lat);
    });
    for (const i of earcut(flat, holes)) {
      verts.push(Math.round(flat[i * 2] * 100), Math.round(flat[i * 2 + 1] * 100));
    }
  }
}

writeFileSync(`${OUT_DIR}/land.bin`, Buffer.from(new Int16Array(verts).buffer));
console.log(`Baked ${verts.length / 6} land triangles -> ${OUT_DIR}/land.bin`);
