import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

// 1. Bake land polygons
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];

for (const feature of land.features) {
  const shapes = feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as Ring[]]
    : feature.geometry.coordinates as Ring[][];
  for (const shape of shapes) {
    // 4 decimals (about 4 km at the equator) is finer than the 110m data.
    polygons.push(shape.map((ring) => ring.map(([lon, lat]) => [
      Number(mercX(lon).toFixed(4)),
      Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(4)),
    ])));
  }
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

// 2. Bake Bay Area highway lines
interface RoadFeature {
  geometry: {
    type: string;
    coordinates: any;
  };
}

const roads = JSON.parse(readFileSync(source('deckgl-highway-roads'), 'utf8')) as { features: RoadFeature[] };
const highwayLines: number[][][] = [];

for (const f of roads.features) {
  const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const seg of coords) {
    if (Array.isArray(seg) && Array.isArray(seg[0])) {
      const pts = seg as [number, number][];
      if (pts.some(([lon, lat]) => lon > -123.5 && lon < -121.0 && lat > 37.0 && lat < 38.8)) {
        highwayLines.push(pts.map(([lon, lat]) => [
          Number(mercX(lon).toFixed(6)),
          Number(mercY(lat).toFixed(6)),
        ]));
      }
    }
  }
}

const dir = 'data/baked/tangram-004-highways-demo';
mkdirSync(dir, { recursive: true });

writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/highways.json`, JSON.stringify(highwayLines));
writeFileSync(`${dir}/coast.json`, JSON.stringify(coast));
console.log(`Baked ${polygons.length} land polygons and ${highwayLines.length} highway lines -> ${dir}`);
