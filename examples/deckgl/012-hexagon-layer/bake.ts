// Pack the original deck.gl HexagonLayer demo's UK road-accident positions.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

const text = readFileSync(source('deckgl-uk-road-accidents'), 'utf8');
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const points: { x: number; y: number }[] = [];
for (const line of text.split(/\r?\n/).slice(1)) {
  const [lonText, latText] = line.split(',');
  if (!lonText || !latText) continue;
  const lon = Number(lonText), lat = Number(latText);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -85 || lat > 85) continue;
  points.push({ x: (lon + 180) / 360, y: mercY(lat) });
}
if (!points.length) throw new Error('no valid positions');
let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
for (const p of points) {
  west = Math.min(west, p.x); east = Math.max(east, p.x);
  north = Math.min(north, p.y); south = Math.max(south, p.y);
}
const out = Buffer.alloc(32 + points.length * 4);
out.write('HX01', 0, 'ascii');
out.writeUInt32LE(points.length, 4);
out.writeFloatLE(west, 8); out.writeFloatLE(north, 12);
out.writeFloatLE(east, 16); out.writeFloatLE(south, 20);
for (let i = 0; i < points.length; i++) {
  const p = points[i];
  out.writeUInt16LE(Math.round((p.x - west) / (east - west) * 65535), 32 + i * 4);
  out.writeUInt16LE(Math.round((p.y - north) / (south - north) * 65535), 34 + i * 4);
}
const path = 'data/baked/deckgl-012-hexagon-layer/points.bin';
mkdirSync('data/baked/deckgl-012-hexagon-layer', { recursive: true });
writeFileSync(path, out);
console.log(`${points.length} UK accidents, ${out.length} bytes -> ${path}`);
