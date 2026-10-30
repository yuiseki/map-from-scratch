// examples/deckgl/014-line-layer/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../../../tools/sources.ts';

interface CountyFeature {
  properties: { name: string; centroid: [number, number, number]; flows: Record<string, number> };
}

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
  return 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
};
const quant = (v: number) => Math.max(0, Math.min(65535, Math.round(v * 65535)));

const rawCounties = JSON.parse(fs.readFileSync(source('deckgl-arc-counties'), 'utf8')) as { features: CountyFeature[] };
const features = rawCounties.features;

const centroids = new Float32Array(features.length * 2);
const names: string[] = [];
for (let i = 0; i < features.length; i++) {
  const [lon, lat] = features[i].properties.centroid;
  centroids[i * 2] = mercX(lon);
  centroids[i * 2 + 1] = mercY(lat);
  names.push(features[i].properties.name);
}

// The source stores every county pair twice: flows[t][s] === -flows[s][t], so
// drawing all records paints each segment twice and the second colour wins.
// Keep one record per pair (s < t), orient it west->east and let the sign be
// the net migration direction (positive = eastward), then take the 1,500
// strongest pairs. On a CPU-backed canvas frame_interval_ms p95 measured
// 35.6 ms at 3,000 segments and 18.8 ms at 2,000 (budget 20 ms), while
// 1,500 sits at 15.5 ms with p50 11.6 ms.
const pairs: { a: number; b: number; v: number }[] = [];
for (let s = 0; s < features.length; s++) {
  for (const [tStr, val] of Object.entries(features[s].properties.flows || {})) {
    const t = Number(tStr);
    if (t <= s || t >= features.length) continue;
    // flows[s][t] > 0 is a net in-flow to s, i.e. people moving t -> s
    // (deck.gl colours it as in-flow; Los Angeles has -12,111 for Riverside).
    // With a the western end, eastward is a -> b: -flows[a][b].
    const east = features[t].properties.centroid[0] >= features[s].properties.centroid[0];
    pairs.push(east ? { a: s, b: t, v: -val } : { a: t, b: s, v: val });
  }
}
pairs.sort((p, q) => Math.abs(q.v) - Math.abs(p.v));
const kept = pairs.slice(0, 1500);
const eastward = kept.filter((p) => p.v > 0).length;
console.log(
  `Baking ${features.length} counties, ${kept.length} of ${pairs.length} pairs ` +
  `(${eastward} eastward, ${kept.length - eastward} westward)...`,
);

// Binary: 'DLIN' + version u16 + count u32, then 12-byte records
// [sx u16, sy u16, tx u16, ty u16, v i32] with coords quantised over [0, 1].
const headerSize = 10;
const buf = Buffer.alloc(headerSize + kept.length * 12);
buf.write('DLIN', 0, 4, 'ascii');
buf.writeUInt16LE(1, 4);
buf.writeUInt32LE(kept.length, 6);
let offset = headerSize;
for (const f of kept) {
  buf.writeUInt16LE(quant(centroids[f.a * 2]), offset);
  buf.writeUInt16LE(quant(centroids[f.a * 2 + 1]), offset + 2);
  buf.writeUInt16LE(quant(centroids[f.b * 2]), offset + 4);
  buf.writeUInt16LE(quant(centroids[f.b * 2 + 1]), offset + 6);
  buf.writeInt32LE(f.v, offset + 8);
  offset += 12;
}

// Land polygons as JSON for the background.
type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(fs.readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
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

const outDir = path.resolve('data/baked/deckgl-014-line-layer');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'lines.bin'), buf);
fs.writeFileSync(path.join(outDir, 'land.json'), JSON.stringify(polygons));
console.log(`Wrote lines.bin (${(buf.length / 1024).toFixed(1)} KB) and ${polygons.length} land polygons -> ${outDir}`);
