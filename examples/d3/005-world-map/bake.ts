import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as {
  features: { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } }[];
};

const xOf = (lon: number): number => (lon + 180) / 360;
const yOf = (lat: number): number => (90 - lat) / 180;

// Unwrap longitudes so consecutive points never jump by more than 180 deg.
function unwrap(ring: Ring): Ring {
  const out: Ring = [[ring[0][0], ring[0][1]]];
  for (let i = 1; i < ring.length; i++) {
    let lon = ring[i][0];
    const prev = out[out.length - 1][0];
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    out.push([lon, ring[i][1]]);
  }
  return out;
}

// Split a ring at the antimeridian. Each piece is already shifted into
// x in [0, 1]; k is the unit interval it came from, so the exterior and its
// holes stay together. Without the cut a ring crossing 180 deg fills as a
// band across the whole map.
function cut(ring: Ring): { k: number; ring: number[][] }[] {
  const u = unwrap(ring);
  const pieces: { k: number; ring: number[][] }[] = [];
  let k = Math.floor(xOf(u[0][0]));
  let cur: number[][] = [[Number((xOf(u[0][0]) - k).toFixed(5)), Number(yOf(u[0][1]).toFixed(5))]];
  for (let i = 1; i < u.length; i++) {
    const py = yOf(u[i - 1][1]);
    const cy = yOf(u[i][1]);
    const b = xOf(u[i][0]);
    let a = cur[cur.length - 1][0] + k;
    while (b > k + 1) {
      const iy = py + (cy - py) * ((k + 1 - a) / (b - a));
      cur.push([1, Number(iy.toFixed(5))]);
      pieces.push({ k, ring: cur });
      k += 1;
      a = k;
      cur = [[0, Number(iy.toFixed(5))]];
    }
    while (b < k) {
      const iy = py + (cy - py) * ((k - a) / (b - a));
      cur.push([0, Number(iy.toFixed(5))]);
      pieces.push({ k, ring: cur });
      k -= 1;
      a = k;
      cur = [[1, Number(iy.toFixed(5))]];
    }
    cur.push([Number((b - k).toFixed(5)), Number(cy.toFixed(5))]);
  }
  pieces.push({ k, ring: cur });
  return pieces;
}

const polygons: number[][][][] = [];

for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    const slices = new Map<number, number[][][]>();
    for (const ring of shape) {
      for (const piece of cut(ring)) {
        const bucket = slices.get(piece.k) ?? [];
        bucket.push(piece.ring);
        slices.set(piece.k, bucket);
      }
    }
    for (const rings of slices.values()) polygons.push(rings);
  }
}

const dir = 'data/baked/d3-005-world-map';
mkdirSync(dir, { recursive: true });

const landPath = `${dir}/land.json`;
writeFileSync(landPath, JSON.stringify(polygons));
console.log(`${polygons.length} land polygons -> ${landPath}`);
