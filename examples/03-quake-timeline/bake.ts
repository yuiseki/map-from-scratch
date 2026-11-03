// Bake for the 2025 earthquake playback:
//   land.bin    u32 nVerts, u32 nIdx, u16 xy[nVerts*2], u32 idx[nIdx]
//               all land as one fill, Equal Earth, 16-bit quantised
//   quakes.bin  12-byte records sorted by time:
//               u16 x, u16 y, f32 minutes since 2025-01-01T00:00Z,
//               u8 magnitude*10-40, u8 depth/3 km, u16 pad
//   quakes.json [[time ms, mag, place], ...] same order, for the info line
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { source } from '../../tools/sources.ts';
import { equalEarth, simplify, triangulatePolygon, polygonsOf } from '../../tools/geo.ts';
import type { Point } from '../../tools/geo.ts';
import { depthByte, magnitudeByte, quakeMinutes } from './quake-data.ts';

// The parts of the two GeoJSON sources this bake reads.
interface Countries { features: { geometry: { type: string; coordinates: unknown } | null }[] }
interface Quakes {
  features: {
    geometry: { coordinates: [number, number, number] };   // lon, lat, depth km
    properties: { type: string; time: number; mag: number; place: string };
  }[];
}

const OUT = 'data/baked/03-quake-timeline';
const X = 2.7066, Y = 1.3174;
const TOL = (2 * X) / (1280 * 8) * 1.5;   // 1.5 px at 8x zoom on a 1280 px window
const T0 = Date.UTC(2025, 0, 1);
const q = ([x, y]: Point): [number, number] => [Math.round(((x + X) / (2 * X)) * 65535), Math.round(((Y - y) / (2 * Y)) * 65535)];

const verts: number[] = [], idx: number[] = [];
for (const f of (JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as Countries).features) {
  for (const poly of polygonsOf(f.geometry)) {
    const rings = poly.map((r) => simplify(r.map(equalEarth), TOL).map(q)).filter((r) => r.length >= 4);
    if (!rings.length) continue;
    const base = verts.length / 2;
    const t = triangulatePolygon(rings);
    verts.push(...t.vertices);
    for (const i of t.indices) idx.push(base + i);
  }
}
const land = Buffer.concat([Uint32Array.of(verts.length / 2, idx.length), Uint16Array.from(verts), Uint32Array.from(idx)].map((a) => Buffer.from(a.buffer)));

const events = (JSON.parse(readFileSync(source('usgs-quakes-2025'), 'utf8')) as Quakes).features
  .filter((f) => f.properties.type === 'earthquake')
  .sort((a, b) => a.properties.time - b.properties.time);
const rec = Buffer.alloc(events.length * 12);
events.forEach((f, i) => {
  const [lon, lat, depth] = f.geometry.coordinates;
  const [x, y] = q(equalEarth([lon, lat]));
  rec.writeUInt16LE(x, i * 12);
  rec.writeUInt16LE(y, i * 12 + 2);
  rec.writeFloatLE(quakeMinutes(f.properties.time, T0), i * 12 + 4);
  rec.writeUInt8(magnitudeByte(f.properties.mag), i * 12 + 8);
  rec.writeUInt8(depthByte(depth), i * 12 + 9);
});

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/land.bin`, land);
writeFileSync(`${OUT}/quakes.bin`, rec);
writeFileSync(`${OUT}/quakes.json`, JSON.stringify(events.map((f) => [f.properties.time, f.properties.mag, f.properties.place])));
console.log(`land: ${verts.length / 2} vertices, ${idx.length / 3} triangles, ${land.length} bytes; quakes: ${events.length} events, ${rec.length} bytes`);
