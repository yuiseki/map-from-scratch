import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { contourLevels, extractContours, renderPrintableSvg, stitchSegments, type PrintSheet } from './print.ts';

const SOURCE = '/sata_hdd_24tb/hf_data/gsi-dem-fuji-z14-100m-2026-10-25/data/elevation_100m.parquet';
const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-30');
const AOI = { minGridX: 371218, maxGridX: 371456, minGridY: 165525, maxGridY: 165718 };
const WIDTH = AOI.maxGridX - AOI.minGridX;
const HEIGHT = AOI.maxGridY - AOI.minGridY;
const WORLD = 2 * Math.PI * 6378137;
const HALF_WORLD = WORLD / 2;
const PIXEL = WORLD / (2 ** 14 * 256);
const STEP = PIXEL * 10;
const ORIGIN_X = -HALF_WORLD + AOI.minGridX * STEP;
const ORIGIN_Y = HALF_WORLD - AOI.minGridY * STEP;

interface Row { grid_x: number; grid_y: number; elevation_mean_m: number | null; elevation_min_m: number | null; elevation_max_m: number | null; valid_pixels: number | null }
function query(sql: string): Row[] {
  const args = ['-json', '-c', sql];
  const raw = existsSync('/.dockerenv')
    ? execFileSync('duckdb', args, { encoding: 'utf8', maxBuffer: 16 << 20 })
    : execFileSync('docker', [
      'run', '--rm', '--memory=8g', '--cpus=4',
      '-v', '/sata_hdd_24tb:/sata_hdd_24tb:ro',
      'mfs-base:latest', 'duckdb', ...args,
    ], { encoding: 'utf8', maxBuffer: 16 << 20 });
  const start = raw.indexOf('['); const end = raw.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB returned no JSON rows: ${raw.slice(0, 300)}`);
  return JSON.parse(raw.slice(start, end + 1)) as Row[];
}
function lonFromX(x: number): number { return x / 6378137 * 180 / Math.PI; }
function latFromY(y: number): number { return (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI; }

const rows = query(`SELECT grid_x, grid_y, elevation_mean_m, elevation_min_m, elevation_max_m, valid_pixels
FROM read_parquet('${SOURCE}')
WHERE grid_x >= ${AOI.minGridX} AND grid_x < ${AOI.maxGridX}
  AND grid_y >= ${AOI.minGridY} AND grid_y < ${AOI.maxGridY}
ORDER BY grid_y, grid_x`);
if (rows.length !== WIDTH * HEIGHT) throw new Error(`AOI expected ${WIDTH * HEIGHT} rows, got ${rows.length}`);
const values = Array<number | null>(WIDTH * HEIGHT).fill(null);
const valid = Array<number>(WIDTH * HEIGHT).fill(0);
let validCells = 0; let min = Infinity; let max = -Infinity; let sourceMin = Infinity; let sourceMax = -Infinity;
for (const row of rows) {
  const index = (row.grid_y - AOI.minGridY) * WIDTH + (row.grid_x - AOI.minGridX);
  if (index < 0 || index >= values.length) throw new Error(`Out-of-AOI row ${row.grid_x},${row.grid_y}`);
  const isValid = row.valid_pixels !== null && row.valid_pixels > 0 && row.elevation_mean_m !== null;
  if (isValid) {
    values[index] = row.elevation_mean_m;
    valid[index] = 1; validCells++;
    min = Math.min(min, row.elevation_mean_m!); max = Math.max(max, row.elevation_mean_m!);
    if (row.elevation_min_m !== null) sourceMin = Math.min(sourceMin, row.elevation_min_m);
    if (row.elevation_max_m !== null) sourceMax = Math.max(sourceMax, row.elevation_max_m);
  }
}
const nodataCells = valid.length - validCells;
if (validCells === 0) throw new Error('No valid source elevations in AOI');
const bounds = { minX: ORIGIN_X, maxX: ORIGIN_X + WIDTH * STEP, minY: ORIGIN_Y - HEIGHT * STEP, maxY: ORIGIN_Y };
const centerLat = latFromY((bounds.minY + bounds.maxY) / 2);
const levels = contourLevels(min, max, 100);
const frame = {
  xMm: 12, yMm: 37,
  widthMm: (bounds.maxX - bounds.minX) * Math.cos(centerLat * Math.PI / 180) * 1000 / 100_000,
  heightMm: (bounds.maxY - bounds.minY) * Math.cos(centerLat * Math.PI / 180) * 1000 / 100_000,
  scale: 100_000, centerLatitude: centerLat,
};
const grid = { width: WIDTH, height: HEIGHT, originX: ORIGIN_X, originY: ORIGIN_Y, stepX: STEP, stepY: -STEP, values: values.map(value => value ?? Number.NaN), valid };
const sheet: PrintSheet = {
  title: '富士山 手書き地図ガイド', grid, bounds, frame, levels, intervalM: 100, minElevationM: min, maxElevationM: max,
  attribution: 'Source: Geospatial Information Authority of Japan (GSI), elevation tiles (Fundamental Geospatial Data elevation model), https://maps.gsi.go.jp/development/ichiran.html. Edited and aggregated into 10×10-pixel cells by yuiseki. This is not an official GSI product.',
};
const contours = extractContours(grid, levels);
const segmentCount = contours.reduce((sum, line) => sum + line.segments.length, 0);
const pathCount = contours.reduce((sum, line) => sum + stitchSegments(line.segments).length, 0);
const data = {
  schema: 1,
  source: {
    id: 'hf:gsi-dem-fuji-z14-100m-2026-10-25', file: SOURCE,
    fetchedAt: '2026-10-25', zoom: 14, sourceTileCount: 100, sourceTileBytes: 51751171,
    sourceTileHashVerification: '100/100 manifest SHA-256 and byte sizes matched before bake',
    table: 'read_parquet', crs: 'EPSG:3857', fields: ['grid_x', 'grid_y', 'elevation_mean_m', 'elevation_min_m', 'elevation_max_m', 'valid_pixels'],
    method: 'Each cell aggregates a 10×10 block of z14 raster pixels; DEM10B values are interpolated from Fundamental Geospatial Data elevation data.',
  },
  aoi: {
    sourceGrid: AOI, boundsEpsg3857: bounds,
    boundsWgs84: { west: lonFromX(bounds.minX), east: lonFromX(bounds.maxX), south: latFromY(bounds.minY), north: latFromY(bounds.maxY) },
    grid: { width: WIDTH, height: HEIGHT, cellSizeM: STEP, originX: ORIGIN_X, originY: ORIGIN_Y, rowOrder: 'north-to-south' },
    print: { paper: 'A4 landscape', scale: '1:100,000 ground scale at center latitude', centerLatitude: centerLat, mapFrameMm: frame, scaleCorrection: 'EPSG:3857 projected coordinates multiplied by cos(center latitude) to retain local ground scale.' },
  },
  elevations: { field: 'elevation_mean_m', unit: 'm', minMeanM: min, maxMeanM: max, minCellMinM: sourceMin, maxCellMaxM: sourceMax, contourIntervalM: 100, contourLevelsM: levels },
  contours: { segmentCount, pathCount, algorithm: 'marching squares with bilinear center-value saddle decider; paths stitched on shared interpolated cell edges' },
  counts: { rows: rows.length, validCells, nodataCells, validPixels: 'positive pixel count with finite mean only; null/zero valid_pixels remain nodata' },
  grid: { values, valid },
};
const json = JSON.stringify(data);
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'dem.json'), json);
const stats = { ...data, grid: undefined, outputBytes: Buffer.byteLength(json) };
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
const svg = renderPrintableSvg(sheet);
writeFileSync(resolve(OUTPUT, 'sheet.svg'), svg);
console.log(`Day30 DEM bake: ${rows.length} rows; ${validCells} valid; ${nodataCells} nodata; ${min.toFixed(2)}–${max.toFixed(2)} m mean; ${levels.length} contour levels; ${segmentCount} segments / ${pathCount} paths; JSON ${Buffer.byteLength(json)} B; SVG ${Buffer.byteLength(svg)} B`);
