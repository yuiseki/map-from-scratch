// examples/deckgl/001-arc-layer/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import { source } from '../../../tools/sources.ts';

interface GeoJSONFeature {
  properties: {
    name: string;
    centroid: [number, number, number];
    flows: Record<string, number>;
  };
  geometry: {
    type: string;
    coordinates: any;
  };
}

function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

async function main() {
  const countiesSrc = source('deckgl-arc-counties');
  const landSrc = source('ne-110m-land');

  const rawCounties = JSON.parse(fs.readFileSync(countiesSrc, 'utf8'));
  const rawLand = JSON.parse(fs.readFileSync(landSrc, 'utf8'));

  const features: GeoJSONFeature[] = rawCounties.features;
  const countyCount = features.length;

  // Extract centroids and names
  const centroids = new Float32Array(countyCount * 2);
  const names: string[] = [];

  for (let i = 0; i < countyCount; i++) {
    const f = features[i];
    names.push(f.properties.name);
    const [lon, lat] = f.properties.centroid;
    const [mx, my] = projectMercator(lon, lat);
    centroids[i * 2] = mx;
    centroids[i * 2 + 1] = my;
  }

  // Curate flows:
  // 1. All flows for major counties (LA: 2082, Cook: 610, Harris: 2613, Maricopa: 106, San Diego: 2151, etc.)
  // 2. All nationwide flows with |v| >= 120
  const majorIndices = new Set([2082, 610, 2613, 106, 2151, 1803, 1800, 2031, 2036, 1567]);
  const flowMap = new Map<string, { s: number; t: number; v: number }>();

  for (let s = 0; s < countyCount; s++) {
    const f = features[s];
    const isMajor = majorIndices.has(s);
    for (const [tStr, val] of Object.entries(f.properties.flows || {})) {
      const t = Number(tStr);
      if (t < 0 || t >= countyCount) continue;
      if (isMajor || Math.abs(val) >= 120) {
        const key = `${s}_${t}`;
        flowMap.set(key, { s, t, v: val });
      }
    }
  }

  const flows = Array.from(flowMap.values());
  const flowCount = flows.length;
  console.log(`Baking ${countyCount} counties, ${flowCount} migration flows...`);

  // Extract land polygons from ne-110m-land
  const landRings: Float32Array[] = [];
  for (const feat of rawLand.features) {
    const geom = feat.geometry;
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (const poly of polys) {
      const exterior = poly[0];
      if (!exterior || exterior.length < 3) continue;
      // Simplify: take points
      const ringPts: number[] = [];
      for (const [lon, lat] of exterior) {
        const [mx, my] = projectMercator(lon, lat);
        ringPts.push(mx, my);
      }
      landRings.push(new Float32Array(ringPts));
    }
  }

  // Encode binary format:
  // Header: 32 bytes
  // - magic: 'DARC' (0x43524144)
  // - version: 1 (uint16)
  // - countyCount: uint16
  // - flowCount: uint32
  // - landRingCount: uint16
  // - nameBytes: uint32
  // Body:
  // - centroids: Float32Array (countyCount * 2 floats)
  // - flows: records of [s: uint16, t: uint16, v: int32] (flowCount * 8 bytes)
  // - land: for each ring: uint16 ptCount, followed by Float32Array of 2*ptCount
  // - names: utf-8 json string

  const namesJson = JSON.stringify(names);
  const namesBuffer = Buffer.from(namesJson, 'utf8');

  let landBytes = 0;
  for (const ring of landRings) {
    landBytes += 4 + ring.length * 4;
  }

  const headerSize = 32;
  const centroidsSize = countyCount * 2 * 4;
  const flowsSize = flowCount * 8;
  const totalSize = headerSize + centroidsSize + flowsSize + landBytes + namesBuffer.length;

  const buf = Buffer.alloc(totalSize);
  let offset = 0;

  // Header
  buf.write('DARC', 0, 4, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(countyCount, 6);
  buf.writeUInt32LE(flowCount, 8);
  buf.writeUInt16LE(landRings.length, 12);
  buf.writeUInt32LE(namesBuffer.length, 14);
  offset = 32;

  // Centroids
  for (let i = 0; i < centroids.length; i++) {
    buf.writeFloatLE(centroids[i], offset);
    offset += 4;
  }

  // Flows
  for (let i = 0; i < flowCount; i++) {
    const fl = flows[i];
    buf.writeUInt16LE(fl.s, offset);
    buf.writeUInt16LE(fl.t, offset + 2);
    buf.writeInt32LE(fl.v, offset + 4);
    offset += 8;
  }

  // Land rings
  for (const ring of landRings) {
    const ptCount = ring.length / 2;
    buf.writeUInt32LE(ptCount, offset);
    offset += 4;
    for (let i = 0; i < ring.length; i++) {
      buf.writeFloatLE(ring[i], offset);
      offset += 4;
    }
  }

  // Names
  namesBuffer.copy(buf, offset);
  offset += namesBuffer.length;

  const outDir = path.resolve('data/baked/deckgl-001-arc-layer');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'arcs.bin');
  fs.writeFileSync(outPath, buf);

  console.log(`Wrote ${outPath} (${(totalSize / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
