// examples/kepler/002-open-modal/bake.ts
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

  points.sort((a, b) => a.my - b.my || a.mx - b.mx);

  // 2. Parse Land Polygons
  const landGeo = JSON.parse(fs.readFileSync(landSrc, 'utf8'));
  const landTriangles: number[] = [];
  const landLines: number[] = [];

  function processPolygon(rings: number[][][]) {
    if (!rings.length || !rings[0].length) return;
    const outer = rings[0];
    if (outer.length < 3) return;

    const flatCoords: number[] = [];
    const holeIndices: number[] = [];

    for (let i = 0; i < outer.length; i++) {
      const [mx, my] = projectMercator(outer[i][0], outer[i][1]);
      flatCoords.push(mx, my);
      if (i > 0) {
        const [prevMx, prevMy] = projectMercator(outer[i - 1][0], outer[i - 1][1]);
        landLines.push(prevMx, prevMy, mx, my);
      }
    }

    for (let h = 1; h < rings.length; h++) {
      const hole = rings[h];
      if (hole.length < 3) continue;
      holeIndices.push(flatCoords.length / 2);
      for (let i = 0; i < hole.length; i++) {
        const [mx, my] = projectMercator(hole[i][0], hole[i][1]);
        flatCoords.push(mx, my);
        if (i > 0) {
          const [prevMx, prevMy] = projectMercator(hole[i - 1][0], hole[i - 1][1]);
          landLines.push(prevMx, prevMy, mx, my);
        }
      }
    }

    const indices = earcut(flatCoords, holeIndices, 2);
    for (const idx of indices) {
      landTriangles.push(flatCoords[idx * 2], flatCoords[idx * 2 + 1]);
    }
  }

  for (const feature of landGeo.features) {
    const geom = feature.geometry;
    if (!geom) continue;
    if (geom.type === 'Polygon') {
      processPolygon(geom.coordinates);
    } else if (geom.type === 'MultiPolygon') {
      for (const poly of geom.coordinates) {
        processPolygon(poly);
      }
    }
  }

  const pointBytes = points.length * 4 * 4;
  const triBytes = landTriangles.length * 4;
  const lineBytes = landLines.length * 4;
  const headerSize = 32;
  const totalSize = headerSize + pointBytes + triBytes + lineBytes;

  const buf = Buffer.alloc(totalSize);
  buf.write('KPLR', 0, 4, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt32LE(points.length, 6);
  buf.writeUInt32LE(landTriangles.length / 2, 10);
  buf.writeUInt32LE(landLines.length / 2, 14);

  let offset = headerSize;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    buf.writeFloatLE(p.mx, offset);
    buf.writeFloatLE(p.my, offset + 4);
    buf.writeFloatLE(p.mag, offset + 8);
    buf.writeFloatLE(p.depth, offset + 12);
    offset += 16;
  }

  for (let i = 0; i < landTriangles.length; i++) {
    buf.writeFloatLE(landTriangles[i], offset);
    offset += 4;
  }

  for (let i = 0; i < landLines.length; i++) {
    buf.writeFloatLE(landLines[i], offset);
    offset += 4;
  }

  const outDir = path.resolve('data/baked/kepler-002-open-modal');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'earthquakes.bin');
  fs.writeFileSync(outPath, buf);

  console.log(`Wrote ${totalSize} bytes to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
