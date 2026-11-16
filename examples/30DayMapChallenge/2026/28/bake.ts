import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cellGreenShare, greenShareBand, serializeGreenMap, WORLD_COVER_CLASSES, type CellValues, type GreenMap } from './feeling.ts';

const SOURCE = '/sata_hdd_24tb/hf_data/esa-worldcover-tokyo-2021-100m/data/parquet/esa_worldcover_tokyo_2021_v200_100m.parquet';
const OUTPUT = resolve('data/baked/30DayMapChallenge-2026-28');
const GRID = { west: 139.5, north: 36, step: 1 / 1200, firstRow: 288, rows: 168, firstCol: 192, cols: 204 } as const;
const GREEN_FORMULA = 'pixels_10 + pixels_20 + pixels_30 + pixels_90; green share = green pixels / valid_pixels';
const rawFields = WORLD_COVER_CLASSES.map((code) => `pixels_${code}`).join(', ');

interface SourceRow {
  cell_row: number; cell_col: number; valid_pixels: number; nodata_pixels: number;
  [field: `pixels_${number}`]: number;
}

function queryRows(): SourceRow[] {
  const lastRow = GRID.firstRow + GRID.rows - 1;
  const lastCol = GRID.firstCol + GRID.cols - 1;
  const sql = `SELECT cell_row, cell_col, valid_pixels, nodata_pixels, ${rawFields}
FROM read_parquet('${SOURCE}')
WHERE cell_row BETWEEN ${GRID.firstRow} AND ${lastRow}
  AND cell_col BETWEEN ${GRID.firstCol} AND ${lastCol}
ORDER BY cell_row, cell_col;`;
  const stdout = execFileSync('duckdb', ['-json', '-c', sql], { encoding: 'utf8', maxBuffer: 32 << 20 });
  const start = stdout.indexOf('[{'), end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB returned no WorldCover rows: ${stdout.slice(0, 300)}`);
  return JSON.parse(stdout.slice(start, end + 1)) as SourceRow[];
}

const rows = queryRows();
const cellValues: CellValues[] = rows.map((row, index) => {
  const expectedRow = GRID.firstRow + Math.floor(index / GRID.cols);
  const expectedCol = GRID.firstCol + index % GRID.cols;
  if (row.cell_row !== expectedRow || row.cell_col !== expectedCol) throw new Error(`Missing or out-of-order source grid cell: expected ${expectedRow}/${expectedCol}, got ${row.cell_row}/${row.cell_col}`);
  return [row.valid_pixels, row.nodata_pixels, ...WORLD_COVER_CLASSES.map((code) => row[`pixels_${code}`]!)];
});
const map: GreenMap = { schema: 1, source: 'ESA WorldCover 2021 v200', crs: 'EPSG:4326', grid: { ...GRID }, cells: cellValues };
const json = serializeGreenMap(map);

const classPixelCounts = Object.fromEntries(WORLD_COVER_CLASSES.map((code, i) => [code,
  cellValues.reduce((sum, values) => sum + values[i + 2]!, 0),
]));
const validPixels = cellValues.reduce((sum, values) => sum + values[0]!, 0);
const nodataPixels = cellValues.reduce((sum, values) => sum + values[1]!, 0);
const greenPixels = cellValues.reduce((sum, values) => sum + (cellGreenShare(values) === null ? 0 : values[2]! + values[3]! + values[4]! + values[10]!), 0);
const greenBandCells = Object.fromEntries(Array.from({ length: 7 }, (_, band) => [band, 0])) as Record<number, number>;
for (const values of cellValues) greenBandCells[greenShareBand(cellGreenShare(values))]!++;

const gridBounds = {
  west: GRID.west + GRID.firstCol * GRID.step,
  east: GRID.west + (GRID.firstCol + GRID.cols) * GRID.step,
  north: GRID.north - GRID.firstRow * GRID.step,
  south: GRID.north - (GRID.firstRow + GRID.rows) * GRID.step,
};
const stats = {
  dataset: 'ESA WorldCover 10 m 2021 v200, tile N33E138, 10x10 source-pixel block aggregation',
  datasetId: 'yuiseki/esa-worldcover-tokyo-2021-100m',
  sourcePath: SOURCE,
  sourceSha256: '5c645c746f818467b7d0eaaaf599414fc1f7e3def94f0a0b8eec05759fcb29bb',
  sourceDoi: 'https://doi.org/10.5281/zenodo.7254221',
  sourceYear: 2021,
  sourceVersion: 'v200',
  crs: 'EPSG:4326',
  licence: 'CC BY 4.0',
  attribution: '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium',
  selectedArea: 'Fixed 168×204 source-cell window, rows 288–455 and columns 192–395 inclusive; source grid indices are zero-based from the north-west corner of the 139.5–140.0°E, 35.5–36.0°N crop.',
  gridBounds,
  grid: GRID,
  selectionMethod: 'Filter exact source row/column index ranges; retain complete, unmodified 10×10-source-pixel cell blocks. The rectangle is an AOI, not an administrative boundary.',
  cellCount: cellValues.length,
  validPixels,
  nodataPixels,
  allNoDataCells: cellValues.filter((values) => values[0] === 0).length,
  classPixelCounts,
  greenNumerator: 'ESA classes 10 tree cover + 20 shrubland + 30 grassland + 90 herbaceous wetland.',
  excludedFromGreenNumerator: '40 cropland is kept separate because cultivated land is not treated as natural green respite; 50 built-up, 60 bare/sparse vegetation, 70 snow/ice, 80 water, 95 mangroves and 100 moss/lichen are not included in the selected green proxy.',
  greenPixels,
  greenShare: greenPixels / validPixels,
  greenBandCells,
  outputBytes: Buffer.byteLength(json),
  interpretation: 'Green share is a physical source-class proportion within a WorldCover cell. It does not measure emotion, perceived relief, park boundaries, public access, safety, health or experience. This AOI has no NoData source pixels; NoData is still retained as a separate value state.',
};

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'cells.json'), json);
writeFileSync(resolve(OUTPUT, 'stats.json'), `${JSON.stringify(stats, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ cells: stats.cellCount, validPixels, nodataPixels, greenPixels, greenShare: stats.greenShare, greenBandCells, classPixelCounts, outputBytes: stats.outputBytes })}\n`);
