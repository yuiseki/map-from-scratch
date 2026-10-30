import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
type RoadFeature = {
  properties: { type: string; name: string };
  geometry: { type: string; coordinates: any };
};

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number) => (lon + 180) / 360;

const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
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

// Bay Area highways, grouped by the road class the Tangram filters demo
// toggles: state routes (SR), US highways, interstates (I).
const roads = JSON.parse(readFileSync(source('deckgl-highway-roads'), 'utf8')) as { features: RoadFeature[] };
const groups: Record<string, number[][][]> = { SR: [], US: [], I: [] };
for (const f of roads.features) {
  const type = f.properties.type;
  if (!(type in groups)) continue;
  const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const seg of coords as [number, number][][]) {
    if (!seg.some(([lon, lat]) => lon > -123.5 && lon < -121.0 && lat > 37.0 && lat < 38.8)) continue;
    groups[type].push(seg.map(([lon, lat]) => [
      Number(mercX(lon).toFixed(6)),
      Number(mercY(lat).toFixed(6)),
    ]));
  }
}

// One probe point per class inside the opening view, chosen to sit as far as
// possible from the other classes so a hidden class can be checked cleanly.
const CORE = { w: mercX(-122.9), e: mercX(-121.6), s: mercY(38.1), n: mercY(37.1) };
const inCore = (p: number[]): boolean => p[0] > CORE.w && p[0] < CORE.e && p[1] > CORE.s && p[1] < CORE.n;

const vertices: Record<string, number[][]> = {};
for (const type of Object.keys(groups)) vertices[type] = groups[type].flat().filter(inCore);

const probes: Record<string, number[]> = {};
for (const type of Object.keys(groups)) {
  const others = Object.keys(groups).filter((t) => t !== type).flatMap((t) => vertices[t]);
  let best: number[] = vertices[type][0];
  let bestD = -1;
  for (const v of vertices[type]) {
    let d = Infinity;
    for (const o of others) {
      const dx = v[0] - o[0];
      const dy = v[1] - o[1];
      const d2 = dx * dx + dy * dy;
      if (d2 < d) d = d2;
    }
    if (d > bestD) {
      bestD = d;
      best = v;
    }
  }
  probes[type] = best;
}

// 1b. The 110m coast misses San Francisco Bay and puts the coastal highways
// in the sea. Natural Earth 10m countries, cut to the area of the opening
// view (DETAIL plus a margin the renderer clips away), is drawn over it.
const DETAIL = { w: -128, s: 35, e: -116.5, n: 40.6 };
const M = 0.5;
type Pt = [number, number];
// Sutherland-Hodgman against one axis-aligned edge.
const cut = (ring: Pt[], keep: (p: Pt) => boolean, at: (a: Pt, b: Pt) => Pt): Pt[] => {
  const out: Pt[] = [];
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length];
    if (keep(p)) out.push(p);
    if (keep(p) !== keep(q)) out.push(at(p, q));
  });
  return out;
};
const lerpX = (x: number) => (a: Pt, b: Pt): Pt => [x, a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])];
const lerpY = (y: number) => (a: Pt, b: Pt): Pt => [a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]), y];
const clipRing = (ring: Pt[]): Pt[] => {
  let r = cut(ring, (p) => p[0] >= DETAIL.w - M, lerpX(DETAIL.w - M));
  r = cut(r, (p) => p[0] <= DETAIL.e + M, lerpX(DETAIL.e + M));
  r = cut(r, (p) => p[1] >= DETAIL.s - M, lerpY(DETAIL.s - M));
  return cut(r, (p) => p[1] <= DETAIL.n + M, lerpY(DETAIL.n + M));
};
const countries = JSON.parse(readFileSync(source('ne-countries'), 'utf8')) as { features: LandFeature[] };
const detail: number[][][][] = [];
for (const feature of countries.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    const rings = shape.map((ring) => clipRing(ring.slice(0, -1) as Pt[])).filter((r) => r.length >= 3);
    if (rings.length) detail.push(rings.map((ring) => ring.map(([lon, lat]) => [Number(mercX(lon).toFixed(6)), Number(mercY(lat).toFixed(6))])));
  }
}
const coast = { bbox: [mercX(DETAIL.w), mercY(DETAIL.n), mercX(DETAIL.e), mercY(DETAIL.s)].map((v) => Number(v.toFixed(6))), polygons: detail };

const dir = 'data/baked/tangram-001-filters-demo';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/coast.json`, JSON.stringify(coast));
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/roads.json`, JSON.stringify({ groups, probes }));
console.log(
  `land=${polygons.length}, roads SR=${groups.SR.length} US=${groups.US.length} I=${groups.I.length}, `
  + `probes SR=${probes.SR?.join(',')} US=${probes.US?.join(',')} I=${probes.I?.join(',')} -> ${dir}`,
);
