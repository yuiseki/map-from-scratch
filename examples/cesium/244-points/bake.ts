import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';
import earcut from '../../../vendor/earcut/earcut.js';

const OUT_DIR = 'data/baked/cesium-244-points';
mkdirSync(OUT_DIR, { recursive: true });

// 1. Bake Natural Earth Land as earcut triangles (lon, lat x 100, Int16).
// Rings clipped at the horizon by dropping hidden vertices close with chords
// that cut the land; triangles can be split and pinned to the rim instead.
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
    for (const i of earcut(flat, holes)) verts.push(Math.round(flat[i * 2] * 100), Math.round(flat[i * 2 + 1] * 100));
  }
}

writeFileSync(`${OUT_DIR}/land.bin`, Buffer.from(new Int16Array(verts).buffer));
console.log(`Baked ${verts.length / 6} land triangles -> ${OUT_DIR}/land.bin`);

// 2. Bake 5,000 Global Points (Fibonacci sphere distribution + key anchors)
const count = 5000;
const buf = Buffer.alloc(8 + count * 8);
buf.write('PTS1', 0, 'ascii');
buf.writeUInt32LE(count, 4);

// Point 0: Anchor London (color 0: Yellow)
buf.writeInt16LE(Math.round(-0.1278 * 100), 8);
buf.writeInt16LE(Math.round(51.5074 * 100), 10);
buf.writeUInt8(0, 12);
buf.writeUInt8(8, 13);
buf.writeUInt16LE(0, 14);

// Point 1: Anchor Tokyo (color 1: Cyan)
buf.writeInt16LE(Math.round(139.6917 * 100), 16);
buf.writeInt16LE(Math.round(35.6895 * 100), 18);
buf.writeUInt8(1, 20);
buf.writeUInt8(8, 21);
buf.writeUInt16LE(0, 22);

// Golden ratio for Fibonacci sphere
const phi = (1 + Math.sqrt(5)) / 2;
for (let i = 2; i < count; i++) {
  const y = 1 - (i / (count - 1)) * 2; // y goes from 1 to -1
  const radius = Math.sqrt(1 - y * y);
  const theta = (2 * Math.PI * i) / phi;

  const lon = Math.atan2(Math.sin(theta) * radius, Math.cos(theta) * radius) * (180 / Math.PI);
  const lat = Math.asin(y) * (180 / Math.PI);
  const colorIdx = i % 5;
  const size = 5 + (i % 4);

  const at = 8 + i * 8;
  buf.writeInt16LE(Math.round(lon * 100), at);
  buf.writeInt16LE(Math.round(lat * 100), at + 2);
  buf.writeUInt8(colorIdx, at + 4);
  buf.writeUInt8(size, at + 5);
  buf.writeUInt16LE(0, at + 6);
}

writeFileSync(`${OUT_DIR}/points.bin`, buf);
console.log(`Baked ${count} points (${buf.length} bytes) -> ${OUT_DIR}/points.bin`);
