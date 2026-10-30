import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

interface Feature {
  geometry: { type: string; coordinates: number[] };
  properties: { mag: number | null };
}

const OUT_DIR = 'data/baked/maplibre-053-create-a-heatmap-layer';
mkdirSync(OUT_DIR, { recursive: true });

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

// 1. Process Earthquake Points
const eqRaw = JSON.parse(readFileSync(source('maplibre-cluster-earthquakes'), 'utf8')) as { features: Feature[] };
const valid = eqRaw.features.filter(
  (f) =>
    f.geometry.type === 'Point' &&
    Number.isFinite(f.geometry.coordinates[0]) &&
    Number.isFinite(f.geometry.coordinates[1]) &&
    Math.abs(f.geometry.coordinates[1]) < 85.051129
);

// Format: 8 byte header ("EQHM" + count u32) + 12 bytes per point (float32 x, float32 y, float32 weight)
const out = Buffer.alloc(8 + valid.length * 12);
out.write('EQHM', 0, 'ascii');
out.writeUInt32LE(valid.length, 4);

for (let i = 0; i < valid.length; i++) {
  const f = valid[i];
  const at = 8 + i * 12;
  const lon = f.geometry.coordinates[0];
  const lat = f.geometry.coordinates[1];
  const mag = f.properties.mag ?? 1.0;
  const weight = Math.max(0.1, Math.min(1.0, mag / 6.0));

  out.writeFloatLE((lon + 180) / 360, at);
  out.writeFloatLE(mercY(lat), at + 4);
  out.writeFloatLE(weight, at + 8);
}

const eqPath = `${OUT_DIR}/earthquakes.bin`;
writeFileSync(eqPath, out);
console.log(`Baked ${valid.length} earthquakes (${out.length} bytes) -> ${eqPath}`);

// 2. Process Land Polygons
type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];

for (const feature of land.features) {
  const shapes =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Ring[]]
      : (feature.geometry.coordinates as Ring[][]);

  for (const shape of shapes) {
    polygons.push(
      shape.map((ring) =>
        ring.map(([lon, lat]) => [
          Number(((lon + 180) / 360).toFixed(6)),
          Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(6)),
        ])
      )
    );
  }
}

const landPath = `${OUT_DIR}/land.json`;
writeFileSync(landPath, JSON.stringify(polygons));
console.log(`Baked ${polygons.length} land polygons -> ${landPath}`);
