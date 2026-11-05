import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { equalEarth, polygonsOf, simplify, triangulatePolygon } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';
import { encodeSegments, makeSegments, type TrackObservation } from './tracks.ts';

interface Countries { features: { geometry: { type: string; coordinates: unknown } | null }[] }
const OUTPUT = 'data/baked/30DayMapChallenge-2026-02';
const INPUT = source('ibtracs-since1980');
const X = 2.7066, Y = 1.3174;
const quantize = ([x, y]: Point): [number, number] => [
  Math.max(0, Math.min(65535, Math.round(((x + X) / (2 * X)) * 65535))),
  Math.max(0, Math.min(65535, Math.round(((Y - y) / (2 * Y)) * 65535))),
];

const vertices: number[] = [];
const indices: number[] = [];
for (const feature of (JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as Countries).features) {
  for (const polygon of polygonsOf(feature.geometry)) {
    const rings = polygon.map((ring) => simplify(ring.map(equalEarth), (2 * X / 1280) * 0.5).map(quantize));
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

const sql = `SELECT SID, strftime(ISO_TIME, '%Y-%m-%dT%H:%M:%S'), LON, LAT, BASIN
  FROM read_parquet('${INPUT}')
  WHERE SID IS NOT NULL AND ISO_TIME IS NOT NULL AND LON IS NOT NULL AND LAT IS NOT NULL
    AND BASIN IN ('EP','NA','NI','SA','SI','SP','WP')
  ORDER BY SID, ISO_TIME`;
const csv = execFileSync('duckdb', ['-noheader', '-csv', '-c', sql], { encoding: 'utf8', maxBuffer: 24 << 20 }).trimEnd();
const observations: TrackObservation[] = csv.split('\n').map((line) => {
  const [sid, time, lon, lat, basin] = line.split(',');
  return { sid, time, lon: Number(lon), lat: Number(lat), basin };
});
if (observations.length !== 311935) throw new Error(`Unexpected IBTrACS snapshot: ${observations.length} observations`);
const segments = makeSegments(observations);
if (segments.length < 300000 || segments.some((segment) => !Number.isFinite(segment.a[0] + segment.a[1] + segment.b[0] + segment.b[1]))) {
  throw new Error(`Unexpected IBTrACS tracks: ${segments.length} segments`);
}
const storms = new Set(observations.map(({ sid }) => sid)).size;
const basinSegments = Object.fromEntries(['EP', 'NA', 'NI', 'SA', 'SI', 'SP', 'WP']
  .map((basin) => [basin, segments.filter((segment) => segment.basin === basin).length]));

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/land.bin`, land);
writeFileSync(`${OUTPUT}/tracks.bin`, new Uint8Array(encodeSegments(segments)));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify({ observations: observations.length, storms, segments: segments.length, basinSegments }));
console.log(`land: ${vertices.length / 2} vertices, ${indices.length / 3} triangles, ${land.length} bytes; IBTrACS: ${observations.length} observations, ${storms} storms, ${segments.length} segments`);
