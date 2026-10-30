import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { source } from '../../../tools/sources.ts';

const OUT_DIR = 'data/baked/mapbox-019-animate-ant-path';
mkdirSync(OUT_DIR, { recursive: true });

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

// 1. Great circle interpolation between SF and DC (500 steps)
const lon1 = (-122.414 * Math.PI) / 180;
const lat1 = (37.776 * Math.PI) / 180;
const lon2 = (-77.032 * Math.PI) / 180;
const lat2 = (38.913 * Math.PI) / 180;

// 3D Cartesian coordinates
const v1 = [Math.cos(lat1) * Math.cos(lon1), Math.cos(lat1) * Math.sin(lon1), Math.sin(lat1)];
const v2 = [Math.cos(lat2) * Math.cos(lon2), Math.cos(lat2) * Math.sin(lon2), Math.sin(lat2)];

// Dot product
const dot = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
const omega = Math.acos(Math.max(-1, Math.min(1, dot)));
const sinOmega = Math.sin(omega);

const steps = 500;
const route: [number, number][] = [];

for (let i = 0; i <= steps; i++) {
  const t = i / steps;
  let p: number[];
  if (sinOmega < 1e-6) {
    p = v1;
  } else {
    const s1 = Math.sin((1 - t) * omega) / sinOmega;
    const s2 = Math.sin(t * omega) / sinOmega;
    p = [s1 * v1[0] + s2 * v2[0], s1 * v1[1] + s2 * v2[1], s1 * v1[2] + s2 * v2[2]];
  }

  const pLat = Math.asin(p[2]) * (180 / Math.PI);
  const pLon = Math.atan2(p[1], p[0]) * (180 / Math.PI);
  route.push([
    Number(mercX(pLon).toFixed(6)),
    Number(mercY(pLat).toFixed(6)),
  ]);
}

writeFileSync(`${OUT_DIR}/route.json`, JSON.stringify(route));
console.log(`Baked 501-point great circle route -> ${OUT_DIR}/route.json`);

// 2. Natural Earth Land
type Ring = number[][];
type LandFeature = { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: Ring[] | Ring[][] } };
const land = JSON.parse(readFileSync(source('ne-110m-land'), 'utf8')) as { features: LandFeature[] };
const polygons: number[][][][] = [];

for (const feature of land.features) {
  const shapes =
    feature.geometry.type === 'Polygon'
      ? [feature.geometry.coordinates as Ring[]]
      : (feature.geometry.coordinates as Ring[][]);

  for (const shape of shapes) {
    polygons.push(
      shape.map((ring) =>
        ring.map(([lon, lat]) => [
          Number(mercX(lon).toFixed(6)),
          Number(mercY(Math.max(-85.051128, Math.min(85.051128, lat))).toFixed(6)),
        ])
      )
    );
  }
}

writeFileSync(`${OUT_DIR}/land.json`, JSON.stringify(polygons));
console.log(`Baked ${polygons.length} land polygons -> ${OUT_DIR}/land.json`);
