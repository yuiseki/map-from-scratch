import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../tools/sources.ts';

const id = 'd3-016-geotiff-contours-ii';
const dir = `data/baked/${id}`;
mkdirSync(dir, { recursive: true });
const input = source('d3-geotiff-sfctmp');
const raw = `.cache/${id}.bin`;
execFileSync('gdal_translate', ['-q', '-of', 'ENVI', '-ot', 'Float32', input, raw]);
const values = readFileSync(raw);
const width = 720, height = 361;
if (values.length !== width * height * 4) throw new Error(`unexpected raster size: ${values.length}`);
const out = Buffer.allocUnsafe(12 + width * height * 2);
out.write('GT01', 0, 'ascii');
out.writeUInt32LE(width, 4);
out.writeUInt32LE(height, 8);
let min = Infinity, max = -Infinity;
for (let i = 0; i < width * height; i++) {
  const value = values.readFloatLE(i * 4);
  if (!Number.isFinite(value) || value < -100 || value > 100) throw new Error(`invalid value ${value} at ${i}`);
  min = Math.min(min, value);
  max = Math.max(max, value);
  out.writeUInt16LE(Math.round((value + 100) * 100), 12 + i * 2);
}
writeFileSync(`${dir}/temperature.bin`, out);
console.log(`${width}x${height}, min ${min.toFixed(2)}, max ${max.toFixed(2)}, ${out.length} B`);
