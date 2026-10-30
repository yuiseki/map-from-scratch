import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

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
          Number(lon.toFixed(4)),
          Number(lat.toFixed(4)),
        ])
      )
    );
  }
}

writeFileSync(`${OUT_DIR}/countries.json`, JSON.stringify(polygons));
console.log(`Baked ${polygons.length} country polygons -> ${OUT_DIR}/countries.json`);
