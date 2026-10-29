// Convert the deck.gl ScreenGridLayer demo's weighted NYC points into six
// bytes per point (Web Mercator x/y and weight as unsigned 16-bit values).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

const input = JSON.parse(readFileSync(source('deckgl-screen-grid-uber'), 'utf8')) as [number, number, number][];
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const projected = input.map(([lon, lat, weight]) => ({ x: (lon + 180) / 360, y: mercY(lat), weight }));
let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
for (const p of projected) {
  west = Math.min(west, p.x); east = Math.max(east, p.x);
  north = Math.min(north, p.y); south = Math.max(south, p.y);
}
const out = Buffer.alloc(32 + input.length * 6);
out.write('SG01', 0, 'ascii');
out.writeUInt32LE(input.length, 4);
out.writeFloatLE(west, 8);
out.writeFloatLE(north, 12);
out.writeFloatLE(east, 16);
out.writeFloatLE(south, 20);
let total = 0;
for (let i = 0; i < projected.length; i++) {
  const p = projected[i];
  if (!Number.isInteger(p.weight) || p.weight < 0 || p.weight > 65535) throw new Error(`invalid weight at ${i}`);
  const offset = 32 + i * 6;
  out.writeUInt16LE(Math.round((p.x - west) / (east - west) * 65535), offset);
  out.writeUInt16LE(Math.round((p.y - north) / (south - north) * 65535), offset + 2);
  out.writeUInt16LE(p.weight, offset + 4);
  total += p.weight;
}
out.writeUInt32LE(total, 24);
const path = 'data/baked/deckgl-018-screen-grid-layer/points.bin';
mkdirSync('data/baked/deckgl-018-screen-grid-layer', { recursive: true });
writeFileSync(path, out);
console.log(`${input.length} weighted points, total ${total}, ${out.length} bytes -> ${path}`);
