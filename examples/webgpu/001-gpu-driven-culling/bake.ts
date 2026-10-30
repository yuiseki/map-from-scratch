// examples/webgpu/001-gpu-driven-culling/bake.ts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseHeader, decodeBlock } from '../../16-plateau-buildings-3d/plb.ts';

interface TruthData {
  buildings: number;
  points: [number, number, number][]; // [x, y, footprint area m2]: a point on the largest lod0 footprint
  station: { x: number; y: number };
}

// truth.json has no heights, so measure them in 16's archive: the building
// meshes (L0 shells, metres, x east, y north) are cast through vertically at
// each footprint point, and the height is the top hit minus the bottom one.
function measureHeights(plbPath: string, pts: [number, number, number][]): Float32Array {
  const b = new Uint8Array(fs.readFileSync(plbPath));
  const h = parseHeader(b);
  const tris: Float64Array[] = [];
  const boxes: number[][] = [];
  for (const t of h.tiles) {
    const l = t.lv[0];
    if (!l.len) continue;
    const m = decodeBlock(new Uint8Array(zlib.inflateRawSync(b.subarray(l.off, l.off + l.len))));
    const p = (i: number, k: number) => t.min[k] / 100 + m.q[3 * i + k] * 0.01;
    const out = new Float64Array(m.idx.length * 3);
    for (let i = 0; i < m.idx.length; i++) for (let k = 0; k < 3; k++) out[3 * i + k] = p(m.idx[i], k);
    tris.push(out);
    boxes.push([t.min[0] / 100, t.min[1] / 100, (t.min[0] + t.size[0]) / 100, (t.min[1] + t.size[1]) / 100]);
  }
  const heights = new Float32Array(pts.length);
  let missed = 0;
  pts.forEach(([x, y], n) => {
    let lo = Infinity, hi = -Infinity;
    tris.forEach((T, ti) => {
      const [x0, y0, x1, y1] = boxes[ti];
      if (x < x0 || x > x1 || y < y0 || y > y1) return;
      for (let i = 0; i < T.length; i += 9) {
        const ax = T[i], ay = T[i + 1], bx = T[i + 3], by = T[i + 4], cx = T[i + 6], cy = T[i + 7];
        const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(d) < 1e-9) continue; // a wall: no vertical hit
        const u = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / d;
        const v = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const z = u * T[i + 2] + v * T[i + 5] + (1 - u - v) * T[i + 8];
        if (z < lo) lo = z;
        if (z > hi) hi = z;
      }
    });
    if (hi > lo) heights[n] = hi - lo;
    else missed++;
  });
  console.log(`heights: ${pts.length - missed} measured, ${missed} without a hit (drawn 4 m)`);
  return heights;
}

async function main() {
  const truthPath = path.resolve('data/baked/16-plateau-buildings-3d/truth.json');
  if (!fs.existsSync(truthPath)) {
    throw new Error(`truth.json not found at ${truthPath}`);
  }
  const truth: TruthData = JSON.parse(fs.readFileSync(truthPath, 'utf8'));

  const buildingCount = truth.points.length;
  console.log(`Processing ${buildingCount} PLATEAU buildings around Tokyo Station...`);

  // Each building instance: 8 bytes, decimetres
  // [x: i16, y: i16, height: u16, size: u16]; the page derives z, the
  // bounding radius and the colour class (map.ts)
  const instanceData = new Int16Array(buildingCount * 4);
  const measured = measureHeights(path.resolve('data/baked/16-plateau-buildings-3d/tokyo-station-2km.v1.plb'), truth.points);

  for (let i = 0; i < buildingCount; i++) {
    const [x, y, area] = truth.points[i];
    const height = Math.max(4.0, measured[i]); // meters
    // A square with the footprint's real area
    const size = Math.max(2.0, Math.sqrt(area));
    instanceData[i * 4] = Math.round(x * 10);
    instanceData[i * 4 + 1] = Math.round(y * 10);
    // u16 values stored through the i16 view; both are < 32768 dm here
    instanceData[i * 4 + 2] = Math.round(height * 10);
    instanceData[i * 4 + 3] = Math.round(size * 10);
  }

  // Unit cube prototype mesh: [-0.5, -0.5, 0] to [0.5, 0.5, 1]
  // 24 vertices (pos: vec3, normal: vec3) = 6 floats per vertex
  // 36 indices
  const vertices = new Float32Array([
    // Front face (normal 0, -1, 0)
    -0.5, -0.5, 0.0,  0, -1, 0,
     0.5, -0.5, 0.0,  0, -1, 0,
     0.5, -0.5, 1.0,  0, -1, 0,
    -0.5, -0.5, 1.0,  0, -1, 0,
    // Back face (normal 0, 1, 0)
     0.5,  0.5, 0.0,  0,  1, 0,
    -0.5,  0.5, 0.0,  0,  1, 0,
    -0.5,  0.5, 1.0,  0,  1, 0,
     0.5,  0.5, 1.0,  0,  1, 0,
    // Left face (normal -1, 0, 0)
    -0.5,  0.5, 0.0, -1,  0, 0,
    -0.5, -0.5, 0.0, -1,  0, 0,
    -0.5, -0.5, 1.0, -1,  0, 0,
    -0.5,  0.5, 1.0, -1,  0, 0,
    // Right face (normal 1, 0, 0)
     0.5, -0.5, 0.0,  1,  0, 0,
     0.5,  0.5, 0.0,  1,  0, 0,
     0.5,  0.5, 1.0,  1,  0, 0,
     0.5, -0.5, 1.0,  1,  0, 0,
    // Top face (normal 0, 0, 1)
    -0.5, -0.5, 1.0,  0,  0, 1,
     0.5, -0.5, 1.0,  0,  0, 1,
     0.5,  0.5, 1.0,  0,  0, 1,
    -0.5,  0.5, 1.0,  0,  0, 1,
    // Bottom face (normal 0, 0, -1)
    -0.5,  0.5, 0.0,  0,  0, -1,
     0.5,  0.5, 0.0,  0,  0, -1,
     0.5, -0.5, 0.0,  0,  0, -1,
    -0.5, -0.5, 0.0,  0,  0, -1,
  ]);

  const indices = new Uint16Array([
     0,  1,  2,   0,  2,  3, // front
     4,  5,  6,   4,  6,  7, // back
     8,  9, 10,   8, 10, 11, // left
    12, 13, 14,  12, 14, 15, // right
    16, 17, 18,  16, 18, 19, // top
    20, 21, 22,  20, 22, 23, // bottom
  ]);

  // Output binary layout:
  // Header: 32 bytes
  // - magic: 'WGCL' (WebGPU Cull)
  // - version: 2 (u16)
  // - buildingCount: u16 (3992)
  // - vertexCount: u16 (24)
  // - indexCount: u16 (36)
  // Data:
  // - instances: Int16Array (buildingCount * 4 * 2 bytes)
  // - vertices: Float32Array (24 * 6 * 4 bytes)
  // - indices: Uint16Array (36 * 2 bytes)
  const headerSize = 32;
  const instBytes = instanceData.byteLength;
  const vertBytes = vertices.byteLength;
  const idxBytes = indices.byteLength;
  const totalSize = headerSize + instBytes + vertBytes + idxBytes;

  const buf = Buffer.alloc(totalSize);
  buf.write('WGCL', 0, 4, 'ascii');
  buf.writeUInt16LE(2, 4);
  buf.writeUInt16LE(buildingCount, 6);
  buf.writeUInt16LE(vertices.length / 6, 8);
  buf.writeUInt16LE(indices.length, 10);

  let offset = 32;
  Buffer.from(instanceData.buffer).copy(buf, offset);
  offset += instBytes;

  Buffer.from(vertices.buffer).copy(buf, offset);
  offset += vertBytes;

  Buffer.from(indices.buffer).copy(buf, offset);
  offset += idxBytes;

  const outDir = path.resolve('data/baked/webgpu-001-gpu-driven-culling');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'buildings.bin');
  fs.writeFileSync(outPath, buf);

  console.log(`Bake complete: ${outPath} (${(totalSize / 1024).toFixed(1)} KB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
