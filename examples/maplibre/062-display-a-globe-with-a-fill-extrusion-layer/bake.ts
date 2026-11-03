// Bake Natural Earth 10m admin 0 countries (v5.1.1, public domain) for an
// extruded population globe:
//   countries.bin   lid triangles cut into 3 degree cells, and the rings the
//                   walls are rebuilt from (layout in format.ts)
//   countries.json  [[ADM0_A3, NAME, NAME_JA, POP_EST], ...] by country id
// Steps: Douglas–Peucker in degrees (0.05 deg, ~5 km: a 1024 px globe shows
// about 0.35 deg per pixel at the opening view and 0.06 at the closest zoom),
// drop islands under 0.02 deg2 except each country's largest polygon,
// quantise to 0.01 deg, insert a vertex wherever an edge crosses a 3 degree
// grid line, clip every polygon to the grid cells and triangulate each piece
// with earcut (grid.ts).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';
import { simplify, polygonsOf, type Ring } from '../../../tools/geo.ts';
import { densifyRing, ringArea, triangulateCells, type P } from './grid.ts';
import { encode } from './format.ts';

const OUT = 'data/baked/maplibre-062-display-a-globe-with-a-fill-extrusion-layer';
const TOL = 0.05, MIN_AREA = 0.02 * 100 * 100, STEP = 300;

interface CountryFeature {
  properties: { ADM0_A3: string; NAME: string; NAME_JA?: string | null; POP_EST: number };
  geometry: { type: string; coordinates: unknown } | null;
}
const fc: { features: CountryFeature[] } = JSON.parse(readFileSync(source('ne-countries'), 'utf8'));

const q = (r: Ring): P[] => {
  const pts = simplify(r, TOL).map(([x, y]) => [Math.max(-18000, Math.min(18000, Math.round(x * 100))), Math.max(-9000, Math.min(9000, Math.round(y * 100)))]);
  const out: P[] = [];
  for (const p of pts) if (!out.length || out[out.length - 1][0] !== p[0] || out[out.length - 1][1] !== p[1]) out.push(p);
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
};

const lon: number[] = [], lat: number[] = [], id: number[] = [], idx: number[] = [];
const ringLon: number[] = [], ringLat: number[] = [], ringLen: number[] = [], ringId: number[] = [];
const rows: [string, string, string, number][] = [];
let rawPts = 0, dropped = 0;
for (const f of fc.features) {
  const cid = rows.length;
  const p = f.properties;
  rows.push([p.ADM0_A3, p.NAME, p.NAME_JA ?? p.NAME, p.POP_EST]);
  const polys = polygonsOf(f.geometry).map((poly) => {
    rawPts += poly.reduce((s, r) => s + r.length, 0);
    return poly.map(q).filter((r) => r.length >= 3 && ringArea(r) !== 0);
  }).filter((poly) => poly.length && poly[0].length >= 3);
  const largest = Math.max(...polys.map((poly) => Math.abs(ringArea(poly[0]))));
  for (const poly of polys) {
    const a = Math.abs(ringArea(poly[0]));
    if (a < MIN_AREA && a < largest) { dropped++; continue; }
    const rings = poly.map((r) => densifyRing(r, STEP));
    const t = triangulateCells(rings, STEP);
    const base = lon.length;
    for (let i = 0; i < t.vertices.length; i += 2) { lon.push(t.vertices[i]); lat.push(t.vertices[i + 1]); id.push(cid); }
    for (const i of t.indices) idx.push(base + i);
    for (const r of rings) {
      for (const [x, y] of r) { ringLon.push(x); ringLat.push(y); }
      ringLen.push(r.length); ringId.push(cid);
    }
  }
}

const bin = encode({
  lon: Int16Array.from(lon), lat: Int16Array.from(lat), id: Uint16Array.from(id), idx: Uint32Array.from(idx),
  ringLon: Int16Array.from(ringLon), ringLat: Int16Array.from(ringLat), ringLen: Uint32Array.from(ringLen), ringId: Uint16Array.from(ringId),
});
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/countries.bin`, bin);
writeFileSync(`${OUT}/countries.json`, JSON.stringify(rows));
const top = [...rows].sort((a, b) => b[3] - a[3]).slice(0, 3).map((r) => `${r[1]} ${r[3]}`);
console.log(`${rows.length} countries, ${rawPts} source points, ${dropped} small islands dropped -> ` +
  `${lon.length} lid vertices, ${idx.length / 3} lid triangles, ${ringLen.length} rings / ${ringLon.length} ring vertices, ` +
  `countries.bin ${bin.length} bytes; largest: ${top.join(', ')}`);
