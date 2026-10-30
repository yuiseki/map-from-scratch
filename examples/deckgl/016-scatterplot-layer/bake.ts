import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const points = JSON.parse(readFileSync(source('deckgl-scatterplot-manhattan'), 'utf8')) as [number, number, number][];

// 16 bytes per point: mercator x, mercator y, weight, and a spare float kept
// for alignment. Float32 is enough at street zoom (about 6e-8 of the world).
const buf = new Float32Array(points.length * 4);
let maxWeight = 0;
for (let i = 0; i < points.length; i++) {
  const [lng, lat, w] = points[i];
  buf[i * 4] = mercX(lng);
  buf[i * 4 + 1] = mercY(lat);
  buf[i * 4 + 2] = w;
  maxWeight = Math.max(maxWeight, w);
}

const dir = 'data/baked/deckgl-016-scatterplot-layer';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/points.bin`, Buffer.from(buf.buffer));
console.log(`${points.length} points, max weight ${maxWeight} -> ${dir}/points.bin`);
