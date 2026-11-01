// examples/maplibre/033-animate-a-point-along-a-route/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../../../tools/sources.ts';

function mercY(lat: number): number {
  const sin = Math.sin((lat * Math.PI) / 180);
  const clamped = Math.max(-0.9999, Math.min(0.9999, sin));
  return 0.5 - Math.log((1 + clamped) / (1 - clamped)) / (4 * Math.PI);
}

function mercX(lon: number): number {
  return (lon + 180) / 360;
}

// Convert lon, lat in degrees to 3D unit sphere vector
function toVec3(lon: number, lat: number): [number, number, number] {
  const radLon = (lon * Math.PI) / 180;
  const radLat = (lat * Math.PI) / 180;
  return [
    Math.cos(radLat) * Math.cos(radLon),
    Math.cos(radLat) * Math.sin(radLon),
    Math.sin(radLat),
  ];
}

// Convert 3D unit vector to [lon, lat] in degrees
function toLonLat(v: [number, number, number]): [number, number] {
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) * (180 / Math.PI);
  const lon = Math.atan2(v[1], v[0]) * (180 / Math.PI);
  return [lon, lat];
}

// Great circle spherical linear interpolation (Slerp)
function slerp(v0: [number, number, number], v1: [number, number, number], t: number): [number, number, number] {
  let dot = v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2];
  dot = Math.max(-1, Math.min(1, dot));
  const theta = Math.acos(dot);
  if (Math.abs(theta) < 1e-6) return v0;
  const sinTheta = Math.sin(theta);
  const a = Math.sin((1 - t) * theta) / sinTheta;
  const b = Math.sin(t * theta) / sinTheta;
  return [
    a * v0[0] + b * v1[0],
    a * v0[1] + b * v1[1],
    a * v0[2] + b * v1[2],
  ];
}

async function main() {
  const landSrc = source('ne-110m-land');
  const landGeo = JSON.parse(fs.readFileSync(landSrc, 'utf8'));

  // 1. Land polygons
  const polygons: number[][][] = [];
  for (const feat of landGeo.features) {
    const geom = feat.geometry;
    const rawPolys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

    for (const poly of rawPolys) {
      const rings: number[][] = [];
      for (const ring of poly) {
        const flat: number[] = [];
        for (let i = 0; i < ring.length; i++) {
          const pt = ring[i];
          const mx = Math.round(mercX(pt[0]) * 10000) / 10000;
          const my = Math.round(mercY(pt[1]) * 10000) / 10000;
          flat.push(mx, my);
        }
        rings.push(flat);
      }
      polygons.push(rings);
    }
  }

  // 2. Precompute Great Circle Arc from SF to DC
  // origin: [-122.414, 37.776] (San Francisco)
  // destination: [-77.032, 38.913] (Washington D.C.)
  const p0 = toVec3(-122.414, 37.776);
  const p1 = toVec3(-77.032, 38.913);
  const steps = 500;
  const arc: [number, number][] = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const v = slerp(p0, p1, t);
    const [lon, lat] = toLonLat(v);
    const mx = Math.round(mercX(lon) * 100000) / 100000;
    const my = Math.round(mercY(lat) * 100000) / 100000;
    arc.push([mx, my]);
  }

  const outDir = path.resolve('data/baked/maplibre-033-animate-a-point-along-a-route');
  fs.mkdirSync(outDir, { recursive: true });

  const landOut = path.join(outDir, 'land.json');
  fs.writeFileSync(landOut, JSON.stringify(polygons));

  const routeOut = path.join(outDir, 'route.json');
  fs.writeFileSync(routeOut, JSON.stringify(arc));

  console.log(`Wrote ${polygons.length} land polygons and ${arc.length} arc points`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
