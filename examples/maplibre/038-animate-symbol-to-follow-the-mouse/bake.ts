// examples/maplibre/038-animate-symbol-to-follow-the-mouse/bake.ts
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

async function main() {
  const landSrc = source('ne-110m-land');
  const landGeo = JSON.parse(fs.readFileSync(landSrc, 'utf8'));

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

  const outDir = path.resolve('data/baked/maplibre-038-animate-symbol-to-follow-the-mouse');
  fs.mkdirSync(outDir, { recursive: true });

  const landOut = path.join(outDir, 'land.json');
  fs.writeFileSync(landOut, JSON.stringify(polygons));
  console.log(`Wrote ${polygons.length} land polygons to ${landOut}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
