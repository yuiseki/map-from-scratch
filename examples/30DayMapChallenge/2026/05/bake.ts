import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { encodeElevationGrid } from './terrain.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-05';
const INPUT = source('gsi-dem-fuji-100m');
const sql = `SELECT grid_x, grid_y, elevation_mean_m, elevation_min_m, elevation_max_m, valid_pixels
  FROM read_parquet('${INPUT}') ORDER BY grid_y, grid_x`;
const csv = execFileSync('duckdb', ['-noheader', '-csv', '-c', sql], { encoding: 'utf8', maxBuffer: 16 << 20 }).trimEnd();
const rows = csv.split('\n').filter(Boolean).map((line) => line.split(',').map(Number));
if (rows.length !== 65536 || rows.some((row) => row.length !== 6)) throw new Error(`Unexpected GSI Fuji grid: ${rows.length} rows`);
const minX = rows.reduce((min, row) => Math.min(min, row[0]!), Infinity);
const maxX = rows.reduce((max, row) => Math.max(max, row[0]!), -Infinity);
const minY = rows.reduce((min, row) => Math.min(min, row[1]!), Infinity);
const maxY = rows.reduce((max, row) => Math.max(max, row[1]!), -Infinity);
const width = maxX - minX + 1, height = maxY - minY + 1;
if (width !== 256 || height !== 256 || width * height !== rows.length) throw new Error(`Unexpected grid extent ${width}×${height}`);
const elevations = new Float32Array(rows.length), seen = new Uint8Array(rows.length);
let minimum = Infinity, maximum = -Infinity, minCell = Infinity, maxCell = -Infinity, validPixels = 0;
let summit = { x: 0, y: 0, height: -Infinity };
for (const [gx, gy, mean, low, high, valid] of rows) {
  const index = (gy! - minY) * width + gx! - minX;
  if (index < 0 || index >= rows.length || seen[index]) throw new Error(`Duplicate or out-of-range GSI cell ${gx},${gy}`);
  seen[index] = 1; elevations[index] = mean!;
  minimum = Math.min(minimum, mean!); maximum = Math.max(maximum, mean!);
  minCell = Math.min(minCell, low!); maxCell = Math.max(maxCell, high!); validPixels += valid!;
  if (mean! > summit.height) summit = { x: gx! - minX, y: gy! - minY, height: mean! };
}
if (seen.some((value) => value !== 1) || validPixels !== rows.length * 100 || maximum < 3700 || minimum > 300) throw new Error('GSI grid has missing cells or an unexpected elevation range');
const grid = encodeElevationGrid({ width, height, elevations });
const world = 2 * Math.PI * 6_378_137, step = world / (256 * 2 ** 14) * 10;
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/terrain.bin`, new Uint8Array(grid));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify({
  sourceDate: '2026-10-25', width, height, cells: rows.length,
  minimumMean: minimum, maximumMean: maximum, minimumCell: minCell, maximumCell: maxCell,
  validSourcePixels: validPixels, sourcePixelsPerCell: 100, projectedCellSizeM: step,
  bounds: { minX: -world / 2 + minX * step, maxX: -world / 2 + (maxX + 1) * step,
    maxY: world / 2 - minY * step, minY: world / 2 - (maxY + 1) * step },
  summitCell: summit, binaryBytes: grid.byteLength,
}));
console.log(`GSI DEM10B Fuji: ${width}×${height} ${rows.length} cells, ${minimum.toFixed(1)}–${maximum.toFixed(1)} m mean; cell ${step.toFixed(2)} m; ${validPixels} source pixels`);
