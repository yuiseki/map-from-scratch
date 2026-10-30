// examples/kepler/008-custom-map-style/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../../../tools/sources.ts';
import earcut from '../../../vendor/earcut/earcut.js';

function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

async function main() {
  const eqSrc = source('kepler-earthquakes');
  const landSrc = source('ne-110m-land');

  // 1. Parse Earthquakes CSV
  const eqRaw = fs.readFileSync(eqSrc, 'utf8');
  const lines = eqRaw.trim().split('\n');
  const header = lines[0].split(',');
  const latIdx = header.indexOf('Latitude');
  const lonIdx = header.indexOf('Longitude');
  const magIdx = header.indexOf('Magnitude');
  const depthIdx = header.indexOf('Depth');

  if (latIdx === -1 || lonIdx === -1 || magIdx === -1) {
    throw new Error('CSV missing required columns: Latitude, Longitude, Magnitude');
  }

  const points: { mx: number; my: number; mag: number; depth: number }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(',');
    const lat = parseFloat(parts[latIdx]);
    const lon = parseFloat(parts[lonIdx]);
    const mag = parseFloat(parts[magIdx]);
    const depth = depthIdx !== -1 ? parseFloat(parts[depthIdx]) || 0 : 0;
    if (isNaN(lat) || isNaN(lon) || isNaN(mag)) continue;
    const [mx, my] = projectMercator(lon, lat);
    points.push({ mx, my, mag, depth });
  }

  // Sort points by my, then mx for optimal gzip entropy compression
  points.sort((a, b) => a.my - b.my || a.mx - b.mx);
  console.log(`Parsed & sorted ${points.length} earthquake records`);

  // 2. Parse and triangulate Land Polygons
  const landGeo = JSON.parse(fs.readFileSync(landSrc, 'utf8'));
  const landTriangles: number[] = [];
  const landLines: number[] = [];

  for (const feature of landGeo.features) {
    const geom = feature.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];

    for (const poly of polys) {
      const flatCoords: number[] = [];
      const holeIndices: number[] = [];

      for (let r = 0; r < poly.length; r++) {
        const ring = poly[r];
        if (r > 0) {
          holeIndices.push(flatCoords.length / 2);
        }
        for (let j = 0; j < ring.length; j++) {
          const pt = ring[j];
          const [mx, my] = projectMercator(pt[0], pt[1]);
          flatCoords.push(mx, my);

          if (j > 0) {
            const prevPt = ring[j - 1];
            const [pmx, pmy] = projectMercator(prevPt[0], prevPt[1]);
            // Avoid drawing horizontal wraps across Mercator edge
            if (Math.abs(mx - pmx) < 0.5) {
              landLines.push(pmx, pmy, mx, my);
            }
          }
        }
      }

      const indices = earcut(flatCoords, holeIndices, 2);
      for (const idx of indices) {
        landTriangles.push(flatCoords[idx * 2], flatCoords[idx * 2 + 1]);
      }
    }
  }

  console.log(`Generated ${landTriangles.length / 2} land triangle vertices and ${landLines.length / 2} land line vertices`);

  // 3. Pack into single binary format
  // Header:
  // [magic: 4B "KPLR"] [numPoints: uint32] [numLandTriVerts: uint32] [numLandLineVerts: uint32]
  // Data:
  // Points: (mx: f32, my: f32, mag: f32, depth: f32) * numPoints
  // Land Tris: (mx: f32, my: f32) * numLandTriVerts
  // Land Lines: (mx: f32, my: f32) * numLandLineVerts

  const headerSize = 16;
  const pointBytes = points.length * 16;
  const landTriBytes = landTriangles.length * 4;
  const landLineBytes = landLines.length * 4;
  const totalSize = headerSize + pointBytes + landTriBytes + landLineBytes;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const floatView = new Float32Array(buffer);

  // Magic 'KPLR'
  view.setUint8(0, 0x4b);
  view.setUint8(1, 0x50);
  view.setUint8(2, 0x4c);
  view.setUint8(3, 0x52);
  view.setUint32(4, points.length, true);
  view.setUint32(8, landTriangles.length / 2, true);
  view.setUint32(12, landLines.length / 2, true);

  let f32Offset = 4;
  for (const pt of points) {
    floatView[f32Offset++] = pt.mx;
    floatView[f32Offset++] = pt.my;
    floatView[f32Offset++] = pt.mag;
    floatView[f32Offset++] = pt.depth;
  }

  for (let i = 0; i < landTriangles.length; i++) {
    floatView[f32Offset++] = landTriangles[i];
  }

  for (let i = 0; i < landLines.length; i++) {
    floatView[f32Offset++] = landLines[i];
  }

  const outDir = path.resolve('data/baked/kepler-008-custom-map-style');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'earthquakes.bin');
  fs.writeFileSync(outPath, Buffer.from(buffer));
  console.log(`Wrote ${totalSize} bytes to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
