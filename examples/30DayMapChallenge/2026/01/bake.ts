import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../../tools/sources.ts';
import { equalEarth, polygonsOf, simplify, triangulatePolygon } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';
import { encodePoints } from './points.ts';

interface Countries { features: { geometry: { type: string; coordinates: unknown } | null }[] }
interface Quakes {
  features: {
    geometry: { coordinates: [number, number, number] };
    properties: { type: string; mag: number };
  }[];
}

const OUTPUT = 'data/baked/30DayMapChallenge-2026-01';
const X = 2.7066, Y = 1.3174;
const TOLERANCE = (2 * X) / 1280 * 0.5;
const quantize = ([x, y]: Point): [number, number] => [
  Math.max(0, Math.min(65535, Math.round(((x + X) / (2 * X)) * 65535))),
  Math.max(0, Math.min(65535, Math.round(((Y - y) / (2 * Y)) * 65535))),
];

const vertices: number[] = [];
const indices: number[] = [];
for (const feature of (JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as Countries).features) {
  for (const polygon of polygonsOf(feature.geometry)) {
    const rings = polygon.map((ring) => simplify(ring.map(equalEarth), TOLERANCE).map(quantize));
    if (!rings[0] || rings[0].length < 3) continue;
    const base = vertices.length / 2;
    const mesh = triangulatePolygon(rings);
    vertices.push(...mesh.vertices);
    for (const index of mesh.indices) indices.push(base + index);
  }
}

const land = Buffer.alloc(8 + vertices.length * 2 + indices.length * 4);
land.writeUInt32LE(vertices.length / 2, 0);
land.writeUInt32LE(indices.length, 4);
vertices.forEach((value, i) => land.writeUInt16LE(value, 8 + i * 2));
indices.forEach((value, i) => land.writeUInt32LE(value, 8 + vertices.length * 2 + i * 4));

const quakes = (JSON.parse(readFileSync(source('usgs-quakes-2025'), 'utf8')) as Quakes).features
  .filter(({ properties }) => properties.type === 'earthquake')
  .map(({ geometry, properties }) => ({
    lon: geometry.coordinates[0], lat: geometry.coordinates[1],
    magnitude: properties.mag, depthKm: geometry.coordinates[2],
  }));
const points = encodePoints(quakes);

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/land.bin`, land);
writeFileSync(`${OUTPUT}/points.bin`, new Uint8Array(points));
console.log(`land: ${vertices.length / 2} vertices, ${indices.length / 3} triangles, ${land.length} bytes; points: ${quakes.length}, ${points.byteLength} bytes`);
