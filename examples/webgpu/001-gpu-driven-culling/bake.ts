// examples/webgpu/001-gpu-driven-culling/bake.ts
import fs from 'node:fs';
import path from 'node:path';

interface TruthData {
  buildings: number;
  points: [number, number, number][]; // [x, y, maxz_cm]
  station: { x: number; y: number };
}

async function main() {
  const truthPath = path.resolve('data/baked/16-plateau-buildings-3d/truth.json');
  if (!fs.existsSync(truthPath)) {
    throw new Error(`truth.json not found at ${truthPath}`);
  }
  const truth: TruthData = JSON.parse(fs.readFileSync(truthPath, 'utf8'));

  const buildingCount = truth.points.length;
  console.log(`Processing ${buildingCount} PLATEAU buildings around Tokyo Station...`);

  // Each building instance: 8 floats (32 bytes)
  // [x, y, z, height, size, radius, colorType, padding]
  const instanceData = new Float32Array(buildingCount * 8);

  for (let i = 0; i < buildingCount; i++) {
    const [x, y, maxzCm] = truth.points[i];
    const height = Math.max(4.0, maxzCm / 100); // meters
    const z = 0.0;
    // Estimated footprint size based on height and typical city lot
    const size = Math.min(60.0, Math.max(12.0, Math.sqrt(height) * 2.5));
    // Bounding radius
    const radius = Math.sqrt(size * size * 0.5 + height * height * 0.25);
    // Color category by height: 0: low-rise, 1: mid-rise, 2: high-rise
    const colorType = height > 100 ? 2 : height > 40 ? 1 : 0;

    const off = i * 8;
    instanceData[off] = x;
    instanceData[off + 1] = y;
    instanceData[off + 2] = z;
    instanceData[off + 3] = height;
    instanceData[off + 4] = size;
    instanceData[off + 5] = radius;
    instanceData[off + 6] = colorType;
    instanceData[off + 7] = 0;
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
  // - version: 1 (u16)
  // - buildingCount: u16 (3992)
  // - vertexCount: u16 (24)
  // - indexCount: u16 (36)
  // Data:
  // - instances: Float32Array (buildingCount * 8 * 4 bytes)
  // - vertices: Float32Array (24 * 6 * 4 bytes)
  // - indices: Uint16Array (36 * 2 bytes)
  const headerSize = 32;
  const instBytes = instanceData.byteLength;
  const vertBytes = vertices.byteLength;
  const idxBytes = indices.byteLength;
  const totalSize = headerSize + instBytes + vertBytes + idxBytes;

  const buf = Buffer.alloc(totalSize);
  buf.write('WGCL', 0, 4, 'ascii');
  buf.writeUInt16LE(1, 4);
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
