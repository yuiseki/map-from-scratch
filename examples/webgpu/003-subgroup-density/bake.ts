// Bake 1,048,576 Tokyo OSM points for WebGPU Subgroup Density Binning
//
//   points.bin:
//     [0..3]   magic: 0x47535542 ('SUBG')
//     [4..7]   count: 1048576 (2^20)
//     [8..39]  bbox: f64 west, south, east, north
//     [40..]   u16 x, u16 y interleaved (4 bytes per point)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../../..');
const srcPath = join(root, 'data/baked/04-osm-node-density/nodes.bin');
const outDir = join(root, 'data/baked/webgpu-003-subgroup-density');
const outPath = join(outDir, 'points.bin');

const TARGET_COUNT = 1048576; // 2^20 points = 1M points
const MAGIC = 0x47535542;

mkdirSync(outDir, { recursive: true });

if (!existsSync(srcPath)) {
  throw new Error(`Source nodes.bin not found at ${srcPath}. Run bin/mfs bake 04-osm-node-density first.`);
}

const bin = readFileSync(srcPath);
const totalNodes = new Uint32Array(bin.buffer, bin.byteOffset, 1)[0];
const bbox = new Float64Array(bin.buffer, bin.byteOffset + 8, 4);
const dx = new Uint16Array(bin.buffer, bin.byteOffset + 40, totalNodes);
const dy = new Uint16Array(bin.buffer, bin.byteOffset + 40 + totalNodes * 2, totalNodes);

console.log(`Reading ${totalNodes} nodes from 04-osm-node-density...`);

// Decode delta-coded Morton points to absolute coords, keeping every node
// whose share i * TARGET / total crosses an integer. A whole stride
// (floor(9.66 M / 1 M) = 9) stopped at node 9.44 M, and the nodes are in
// Morton order, so the last 2.3 % that were dropped were the whole
// south-east quadrant (Koto, Edogawa).
const outBuffer = new ArrayBuffer(40 + TARGET_COUNT * 4);
const dv = new DataView(outBuffer);
dv.setUint32(0, MAGIC, true);
dv.setUint32(4, TARGET_COUNT, true);
dv.setFloat64(8, bbox[0], true);
dv.setFloat64(16, bbox[1], true);
dv.setFloat64(24, bbox[2], true);
dv.setFloat64(32, bbox[3], true);

const coords = new Uint16Array(outBuffer, 40, TARGET_COUNT * 2);

let curX = 0;
let curY = 0;
let written = 0;

for (let i = 0; i < totalNodes && written < TARGET_COUNT; i++) {
  curX = (curX + dx[i]) & 0xffff;
  curY = (curY + dy[i]) & 0xffff;
  if (Math.floor(((i + 1) * TARGET_COUNT) / totalNodes) > written) {
    coords[written * 2] = curX;
    coords[written * 2 + 1] = curY;
    written++;
  }
}

writeFileSync(outPath, Buffer.from(outBuffer));
const kb = Math.round(outBuffer.byteLength / 1024);
console.log(`Bake complete: ${outPath} (${kb} KB, ${written} points)`);
