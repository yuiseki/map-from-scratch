// examples/webgpu/002-vertex-pulled-roads/bake.ts
import fs from 'node:fs';
import path from 'node:path';

// Bounding box: Tokyo 23 wards
// [W, S, E, N] = [139.55, 35.53, 139.92, 35.82]
const W = 139.55;
const S = 35.53;
const E = 139.92;
const N = 35.82;
const midLatRad = (((S + N) / 2) * Math.PI) / 180;
const k = Math.cos(midLatRad);
const span = Math.max((E - W) * k, N - S);

// Quantize to 0..65535 (~0.5 m resolution per step)
function qX(lon: number): number {
  const norm = ((lon - W) * k) / span;
  return Math.max(0, Math.min(65535, Math.round(norm * 65535)));
}
function qY(lat: number): number {
  const norm = (N - lat) / span;
  return Math.max(0, Math.min(65535, Math.round(norm * 65535)));
}

// Road classes: 0 motorway, 1 trunk, 2 primary
const CLASS_MAP: Record<string, number> = {
  motorway: 0,
  motorway_link: 0,
  trunk: 1,
  trunk_link: 1,
  primary: 2,
  primary_link: 2,
};

async function main() {
  const rawPath = path.resolve('data/raw/tokyo23_highways.json');
  if (!fs.existsSync(rawPath)) {
    throw new Error(`Missing raw data: ${rawPath}`);
  }

  const rawJson = JSON.parse(fs.readFileSync(rawPath, 'utf8'));

  interface RoadWay {
    cls: number;
    points: [number, number][]; // [qx, qy]
  }

  const ways: RoadWay[] = [];
  for (const elem of rawJson.elements) {
    if (elem.type !== 'way' || !elem.geometry || elem.geometry.length < 2) continue;
    const h = elem.tags?.highway || 'primary';
    const cls = CLASS_MAP[h] ?? 2;
    const points: [number, number][] = elem.geometry.map((pt: { lon: number; lat: number }) => [
      qX(pt.lon),
      qY(pt.lat),
    ]);
    ways.push({ cls, points });
  }

  // Sort roads so minor roads (primary) are drawn first, and major highways (motorway) are on top
  ways.sort((a, b) => b.cls - a.cls);

  // Layout for GPU Storage Buffer (Nodes array):
  // Each node: 4 x float32 (16 bytes, GPU-aligned)
  // [x, y, flags, lineId]
  // where:
  //   x, y: normalized coordinate 0..1
  //   flags: bit 0: isStart (1 if first node of road), bit 1: isEnd (1 if last node of road), roadClass (0, 1, 2)
  //   lineId: unique road index
  interface GpuNode {
    x: number;
    y: number;
    cls: number;
    endpoint: number; // 0 = interior, 1 = start, 2 = end, 3 = single-segment start&end
    lineId: number;
  }

  const nodes: GpuNode[] = [];
  let totalSegments = 0;

  for (let wIdx = 0; wIdx < ways.length; wIdx++) {
    const w = ways[wIdx];
    const len = w.points.length;
    totalSegments += len - 1;

    for (let i = 0; i < len; i++) {
      let endpoint = 0;
      if (i === 0 && i === len - 1) endpoint = 3;
      else if (i === 0) endpoint = 1;
      else if (i === len - 1) endpoint = 2;

      nodes.push({
        x: w.points[i][0] / 65535,
        y: w.points[i][1] / 65535,
        cls: w.cls,
        endpoint,
        lineId: wIdx,
      });
    }
  }

  // Node layout: 8 bytes per node
  // - x: uint16 (0..65535)
  // - y: uint16 (0..65535)
  // - flags: uint8 (endpoint: 2 bits, cls: 2 bits)
  // - padding: uint8
  // - roadId: uint16
  // In WGSL, can be unpacked as 2 x u32 or unpacked via bitcast.
  // Or Float32 vec2 + Float32 flags: 12 bytes.
  // If we store [x: f32, y: f32, meta: f32] = 12 bytes (aligned to 16 in storage buffer).
  // With 16 bytes: 88,354 * 16 = 1.38 MB (gzips to 560 KB).
  // If we quantize to Uint16: [x: u16, y: u16, meta: u16, roadId: u16] = 8 bytes.
  // 88,354 * 8 = 706 KB -> gzips to ~280 KB (< 400 KB budget!).
  const nodeCount = nodes.length;
  const nodeBuf = Buffer.alloc(nodeCount * 8);
  for (let i = 0; i < nodeCount; i++) {
    const n = nodes[i];
    const off = i * 8;
    const qx = Math.max(0, Math.min(65535, Math.round(n.x * 65535)));
    const qy = Math.max(0, Math.min(65535, Math.round(n.y * 65535)));
    nodeBuf.writeUInt16LE(qx, off);
    nodeBuf.writeUInt16LE(qy, off + 2);
    // meta: cls (0..2) in bits 0..1, endpoint (0..3) in bits 2..3
    const meta = (n.cls & 0x03) | ((n.endpoint & 0x03) << 2);
    nodeBuf.writeUInt16LE(meta, off + 4);
    nodeBuf.writeUInt16LE(n.lineId & 0xffff, off + 6);
  }

  // Header: 32 bytes
  // - magic: 'VPRD' (Vertex Pulled Roads)
  // - version: 1 (u16)
  // - roadCount: u32
  // - nodeCount: u32
  // - segmentCount: u32
  // - bbox: [W, S, E, N] as float32
  const headerBuf = Buffer.alloc(32);
  headerBuf.write('VPRD', 0, 4, 'ascii');
  headerBuf.writeUInt16LE(1, 4);
  headerBuf.writeUInt32LE(ways.length, 6);
  headerBuf.writeUInt32LE(nodeCount, 10);
  headerBuf.writeUInt32LE(totalSegments, 14);

  const fullData = Buffer.concat([headerBuf, nodeBuf]);

  const outDir = path.resolve('data/baked/webgpu-002-vertex-pulled-roads');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'roads.bin');
  fs.writeFileSync(outPath, fullData);

  console.log(`Bake complete: ${outPath} (${(fullData.length / 1024).toFixed(1)} KB)`);
  console.log(`Roads: ${ways.length.toLocaleString()}, Nodes: ${nodeCount.toLocaleString()}, Segments: ${totalSegments.toLocaleString()}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
