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

const dir = 'data/baked/tangram-001-filters-demo';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/land.json`, JSON.stringify(polygons));
writeFileSync(`${dir}/roads.json`, JSON.stringify({ groups, probes }));
console.log(
  `land=${polygons.length}, roads SR=${groups.SR.length} US=${groups.US.length} I=${groups.I.length}, `
  + `probes SR=${probes.SR?.join(',')} US=${probes.US?.join(',')} I=${probes.I?.join(',')} -> ${dir}`,
);
