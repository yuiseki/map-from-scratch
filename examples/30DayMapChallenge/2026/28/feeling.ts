export const WORLD_COVER_CLASSES = [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100] as const;
export const GREEN_CLASS_CODES = [10, 20, 30, 90] as const;
export const GREEN_BAND_COLORS = ['#334047', '#476e50', '#66975d', '#8cb968', '#bad579', '#e3e9a3'] as const;
export const NO_DATA_COLOR = '#68747a';
export type WorldCoverClass = typeof WORLD_COVER_CLASSES[number];
export type CellValues = number[];
export type Position = [number, number];

export interface GridDefinition {
  west: number;
  north: number;
  step: number;
  firstRow: number;
  rows: number;
  firstCol: number;
  cols: number;
}

export interface GreenMap {
  schema: 1;
  source: 'ESA WorldCover 2021 v200';
  crs: 'EPSG:4326';
  grid: GridDefinition;
  /** Row-major values: valid, nodata, then class counts in WORLD_COVER_CLASSES order. */
  cells: CellValues[];
}

export interface CellInspection {
  sourceRow: number;
  sourceCol: number;
  validPixels: number;
  nodataPixels: number;
  greenPixels: number;
  greenShare: number | null;
  counts: Record<WorldCoverClass, number>;
}

export interface CellBounds { west: number; south: number; east: number; north: number }

export function cellGreenShare(values: CellValues): number | null {
  if (values.length !== WORLD_COVER_CLASSES.length + 2) throw new Error('Invalid source pixel-count row');
  const valid = values[0]!;
  if (valid === 0) return null;
  let green = 0;
  for (const code of GREEN_CLASS_CODES) green += values[WORLD_COVER_CLASSES.indexOf(code) + 2]!;
  return green / valid;
}

export function greenShareBand(share: number | null): number {
  if (share === null) return 6;
  if (!Number.isFinite(share) || share < 0 || share > 1) throw new RangeError('Green share must be between 0 and 1');
  if (share === 0) return 0;
  if (share <= 0.1) return 1;
  if (share <= 0.25) return 2;
  if (share <= 0.5) return 3;
  if (share <= 0.75) return 4;
  return 5;
}

export function validateGreenMap(map: GreenMap): void {
  if (map.schema !== 1 || map.source !== 'ESA WorldCover 2021 v200' || map.crs !== 'EPSG:4326') throw new Error('Unsupported WorldCover schema/source/CRS');
  const { west, north, step, firstRow, rows, firstCol, cols } = map.grid;
  if (![west, north, step].every(Number.isFinite) || step <= 0
      || ![firstRow, rows, firstCol, cols].every(Number.isInteger)
      || firstRow < 0 || firstCol < 0 || rows <= 0 || cols <= 0) throw new Error('Invalid source grid selection');
  if (map.cells.length !== rows * cols) throw new Error(`Invalid cell count: expected ${rows * cols}, got ${map.cells.length}`);
  for (let i = 0; i < map.cells.length; i++) {
    const values = map.cells[i]!;
    if (values.length !== WORLD_COVER_CLASSES.length + 2) throw new Error(`Invalid pixel count vector at cell ${i}`);
    const [valid, nodata] = values;
    if (!Number.isInteger(valid) || !Number.isInteger(nodata) || valid! < 0 || nodata! < 0 || valid! + nodata! !== 100) {
      throw new Error(`Invalid valid/nodata pixel counts at cell ${i}`);
    }
    let classTotal = 0;
    for (let j = 2; j < values.length; j++) {
      const count = values[j]!;
      if (!Number.isInteger(count) || count < 0 || count > 100) throw new Error(`Invalid source pixel count at cell ${i}`);
      classTotal += count;
    }
    if (classTotal !== valid) throw new Error(`Source class count sum does not match valid pixels at cell ${i}`);
  }
}

export function cellBounds(grid: GridDefinition, sourceRow: number, sourceCol: number): CellBounds {
  const west = grid.west + sourceCol * grid.step;
  const north = grid.north - sourceRow * grid.step;
  return { west, south: north - grid.step, east: west + grid.step, north };
}

/** Local equirectangular display coordinates in metres, for this compact Tokyo extent. */
export function projectLocal(point: Position, origin: Position): Position {
  const [lon, lat] = point, [originLon, originLat] = origin;
  const x = (lon - originLon) * 111_320 * Math.cos(originLat * Math.PI / 180);
  const y = -(lat - originLat) * 110_574;
  return [x === 0 ? 0 : x, y === 0 ? 0 : y];
}

export function cellIndexAt(map: GreenMap, point: Position): { row: number; col: number; index: number } | null {
  const { west, north, step, firstRow, rows, firstCol, cols } = map.grid;
  const col = Math.floor((point[0] - west) / step) - firstCol;
  const row = Math.floor((north - point[1]) / step) - firstRow;
  if (row < 0 || row >= rows || col < 0 || col >= cols) return null;
  return { row, col, index: row * cols + col };
}

export function pickCell(map: GreenMap, point: Position): CellInspection | null {
  const index = cellIndexAt(map, point);
  if (!index) return null;
  const values = map.cells[index.index]!;
  const counts = Object.fromEntries(WORLD_COVER_CLASSES.map((code, i) => [code, values[i + 2]!])) as Record<WorldCoverClass, number>;
  const greenPixels = GREEN_CLASS_CODES.reduce((sum, code) => sum + counts[code], 0);
  return {
    sourceRow: map.grid.firstRow + index.row,
    sourceCol: map.grid.firstCol + index.col,
    validPixels: values[0]!,
    nodataPixels: values[1]!,
    greenPixels,
    greenShare: values[0] === 0 ? null : greenPixels / values[0]!,
    counts,
  };
}

export function serializeGreenMap(map: GreenMap): string {
  validateGreenMap(map);
  return JSON.stringify(map);
}
