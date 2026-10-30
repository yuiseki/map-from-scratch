// examples/tangram/008-road-filters-demo/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../../../tools/sources.ts';

interface RoadFeature {
  properties: {
    state: string;
    type: string;
    id: string;
    name: string;
    length: number;
  };
  geometry: {
    type: string;
    coordinates: [number, number][];
  };
}

function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [Math.round(x * 100000) / 100000, Math.round(y * 100000) / 100000];
}

async function main() {
  const roadsSrc = source('deckgl-highway-roads');
  const landSrc = source('ne-110m-land');

  const rawRoads = JSON.parse(fs.readFileSync(roadsSrc, 'utf8'));
  const rawLand = JSON.parse(fs.readFileSync(landSrc, 'utf8'));

  // 1. Process roads (California statewide: Interstate, US Highway, State Route)
  const roads: { n: string; t: number; p: number[] }[] = [];
  for (const f of rawRoads.features as RoadFeature[]) {
    if (f.properties.state !== 'CA') continue;
    const t = f.properties.type;
    const typeCode = t === 'I' ? 0 : t === 'US' ? 1 : 2;
    const geom = f.geometry;
    const lines = geom.type === 'LineString' ? [geom.coordinates] : (geom.coordinates as unknown as [number, number][][]);
    for (const line of lines) {
      const pts: number[] = [];
      for (const [lon, lat] of line) {
        const [mx, my] = projectMercator(lon, lat);
        pts.push(mx, my);
      }
      if (pts.length >= 4) {
        roads.push({ n: f.properties.name || '', t: typeCode, p: pts });
      }
    }
  }

  // 2. Process land rings (filter to North America continent)
  const landRings: number[][] = [];
  for (const feat of rawLand.features) {
    const geom = feat.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      const ext = poly[0];
      if (!ext || ext.length < 3) continue;
      const minX = Math.min(...ext.map((p: number[]) => p[0]));
      const maxX = Math.max(...ext.map((p: number[]) => p[0]));
      const minY = Math.min(...ext.map((p: number[]) => p[1]));
      const maxY = Math.max(...ext.map((p: number[]) => p[1]));
      if (maxX >= -170 && minX <= -50 && maxY >= 10 && minY <= 75) {
        const pts: number[] = [];
        for (const [lon, lat] of ext) {
          const [mx, my] = projectMercator(lon, lat);
          pts.push(mx, my);
        }
        landRings.push(pts);
      }
    }
  }

  const payload = {
    land: landRings,
    roads,
  };

  const outDir = path.resolve('data/baked/tangram-008-road-filters-demo');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'roads.json');
  fs.writeFileSync(outPath, JSON.stringify(payload));

  const stat = fs.statSync(outPath);
  console.log(`Bake completed: ${roads.length} road features, ${landRings.length} land rings.`);
  console.log(`Output: ${outPath} (${(stat.size / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
