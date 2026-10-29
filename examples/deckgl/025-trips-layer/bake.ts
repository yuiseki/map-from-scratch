// Bake the deck.gl TripsLayer demo's taxi paths and building footprints into
// fixed-layout buffers for one-purpose WebGL2 rendering.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import earcut from '../../../vendor/earcut/earcut.js';
import { source } from '../../../tools/sources.ts';

type Position = [number, number];
interface Trip { vendor: number; path: Position[]; timestamps: number[] }
interface Building { polygon: Position[]; height: number }
const trips = JSON.parse(readFileSync(source('deckgl-trips-nyc'), 'utf8')) as Trip[];
const buildings = JSON.parse(readFileSync(source('deckgl-trips-buildings'), 'utf8')) as Building[];
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const project = ([lon, lat]: Position) => [(lon + 180) / 360, mercY(lat)] as const;

let west = Infinity, east = -Infinity, north = Infinity, south = -Infinity;
const visit = (point: Position) => {
  const [x, y] = project(point);
  west = Math.min(west, x); east = Math.max(east, x);
  north = Math.min(north, y); south = Math.max(south, y);
};
for (const building of buildings) for (const p of building.polygon) visit(p);
if (!Number.isFinite(west) || east <= west || south <= north) throw new Error('invalid data bounds');
const quant = (p: Position) => {
  const [x, y] = project(p);
  return [Math.round((x - west) / (east - west) * 65535), Math.round((y - north) / (south - north) * 65535)] as const;
};
const header = (magic: string, count: number, objects: number, bytes: number) => {
  const out = Buffer.alloc(32 + bytes);
  out.write(magic, 0, 'ascii'); out.writeUInt32LE(count, 4); out.writeUInt32LE(objects, 8);
  out.writeFloatLE(west, 12); out.writeFloatLE(north, 16);
  out.writeFloatLE(east, 20); out.writeFloatLE(south, 24);
  return out;
};

interface TrackVertex { p: Position; time: number; vendor: number; gap: boolean }
const track: TrackVertex[] = [];
let segments = 0;
for (const trip of trips) {
  if (trip.path.length !== trip.timestamps.length) throw new Error('trip path and timestamp count differ');
  if (trip.vendor !== 0 && trip.vendor !== 1) throw new Error('invalid vendor');
  for (let i = 0; i < trip.path.length; i++) {
    const time = trip.timestamps[i];
    if (!Number.isFinite(time) || time < 0 || time > 6553.5 || (i > 0 && time < trip.timestamps[i - 1]))
      throw new Error('invalid trip timestamps');
    track.push({ p: trip.path[i], time, vendor: trip.vendor, gap: i === trip.path.length - 1 });
    if (i > 0) segments++;
  }
}
// Global 24-bit Web Mercator keeps the out-of-NYC trip from distorting the
// Manhattan building quantisation. Its spatial step is about 2.4m at equator.
const quant24 = (v: number) => Math.max(0, Math.min(16777215, Math.round(v * 16777215)));
const tripBin = header('TP03', track.length, trips.length, track.length * 10);
tripBin.writeUInt32LE(segments, 28);
for (let i = 0; i < track.length; i++) {
  const v = track[i], [x, y] = project(v.p), o = 32 + i * 10;
  tripBin.writeUIntLE(quant24(x), o, 3); tripBin.writeUIntLE(quant24(y), o + 3, 3);
  tripBin.writeUInt16LE(Math.round(v.time * 10), o + 6);
  tripBin.writeUInt8(v.vendor, o + 8);
  tripBin.writeUInt8(v.gap ? 1 : 0, o + 9);
}

interface Vertex { p: Position; z: number; shade: number }
const mesh: Vertex[] = [], indices: number[] = [];
const vertex = (p: Position, z: number, shade: number) => mesh.push({ p, z, shade });
let usedBuildings = 0;
for (const building of buildings) {
  if (!Number.isFinite(building.height) || building.height <= 0) continue;
  const ring = building.polygon;
  const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    ? ring.length - 1 : ring.length;
  if (n < 3) continue;
  const flat = ring.slice(0, n).flat();
  const roof = earcut(flat, null, 2);
  if (!roof.length) continue;
  usedBuildings++;
  const roofBase = mesh.length;
  for (let i = 0; i < n; i++) vertex(ring[i], building.height, 0.95);
  for (const j of roof) indices.push(roofBase + j);
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const shade = Math.max(0.4, Math.min(0.8, 0.6 + 0.2 * (dx - dy) / (Math.hypot(dx, dy) || 1)));
    const base = mesh.length;
    vertex(a, 0, shade); vertex(b, 0, shade);
    vertex(b, building.height, shade); vertex(a, building.height, shade);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
if (mesh.length > 65535) throw new Error('building mesh exceeds 16-bit index space');
const packedIndices: number[] = [];
let previousIndex = 0;
for (const index of indices) {
  const delta = index - previousIndex;
  previousIndex = index;
  let code = (delta << 1) ^ (delta >> 31);
  while (code >= 128) { packedIndices.push((code & 127) | 128); code >>>= 7; }
  packedIndices.push(code);
}
const buildingBin = header('BD03', mesh.length, indices.length, mesh.length * 8 + packedIndices.length);
buildingBin.writeUInt32LE(usedBuildings, 28);
for (let i = 0; i < mesh.length; i++) {
  const v = mesh[i], [x, y] = quant(v.p), o = 32 + i * 8;
  buildingBin.writeUInt16LE(x, o); buildingBin.writeUInt16LE(y, o + 2);
  buildingBin.writeUInt16LE(Math.min(65535, Math.round(v.z * 10)), o + 4);
  buildingBin.writeUInt8(Math.round(v.shade * 255), o + 6);
}
for (let i = 0; i < packedIndices.length; i++) buildingBin.writeUInt8(packedIndices[i], 32 + mesh.length * 8 + i);

const dir = 'data/baked/deckgl-025-trips-layer';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/trips.bin`, tripBin);
writeFileSync(`${dir}/buildings.bin`, buildingBin);
console.log(`${trips.length} trips, ${track.length} path vertices, ${segments} segments -> ${tripBin.length} bytes`);
console.log(`${usedBuildings}/${buildings.length} buildings, ${mesh.length} shared vertices, ${indices.length} indices -> ${buildingBin.length} bytes`);
console.log(`building bounds ${west.toFixed(6)},${north.toFixed(6)} .. ${east.toFixed(6)},${south.toFixed(6)}`);
