import type { PixelWindow, PlannedTile } from './cog.ts';

export interface RangeSpan {
  start: number;
  end: number;
  tiles: PlannedTile[];
}

export function coalesceTileRanges(tiles: PlannedTile[]): RangeSpan[] {
  const ordered = [...tiles].sort((a, b) => a.offset - b.offset);
  const spans: RangeSpan[] = [];
  for (const tile of ordered) {
    const start = tile.offset;
    const end = tile.offset + tile.byteCount - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new RangeError('Invalid compressed tile byte range');
    const previous = spans.at(-1);
    if (previous && start <= previous.end + 1) {
      if (end > previous.end) previous.end = end;
      previous.tiles.push(tile);
    } else {
      spans.push({ start, end, tiles: [tile] });
    }
  }
  return spans;
}

export function splitRangeTiles(span: RangeSpan, bytes: Uint8Array): Map<number, Uint8Array> {
  if (bytes.byteLength !== span.end - span.start + 1) throw new Error('Range response length does not match coalesced tile span');
  const result = new Map<number, Uint8Array>();
  for (const tile of span.tiles) {
    const from = tile.offset - span.start;
    const to = from + tile.byteCount;
    if (from < 0 || to > bytes.byteLength) throw new RangeError(`Tile ${tile.index} falls outside its coalesced byte span`);
    result.set(tile.index, bytes.slice(from, to));
  }
  return result;
}

export type GeoTransform = readonly [number, number, number, number, number, number];
export type GeographicBounds = readonly [west: number, south: number, east: number, north: number];

function validateNorthUp(transform: GeoTransform): void {
  if (transform.some(value => !Number.isFinite(value)) || transform[1] <= 0 || transform[5] >= 0 || transform[2] !== 0 || transform[4] !== 0) {
    throw new Error('Only finite north-up rasters with positive x and negative y pixel sizes are supported');
  }
}

export function pixelWindowForBounds(transform: GeoTransform, width: number, height: number, bounds: GeographicBounds): PixelWindow {
  validateNorthUp(transform);
  const [west, south, east, north] = bounds;
  if (![west, south, east, north].every(Number.isFinite) || east <= west || north <= south) throw new RangeError('Invalid geographic bounds');
  const [originX, pixelX, , originY, , pixelY] = transform;
  const x0 = Math.max(0, Math.floor((west - originX) / pixelX));
  const x1 = Math.min(width, Math.ceil((east - originX) / pixelX));
  const y0 = Math.max(0, Math.floor((north - originY) / pixelY));
  const y1 = Math.min(height, Math.ceil((south - originY) / pixelY));
  if (x1 <= x0 || y1 <= y0) throw new RangeError('Geographic bounds do not intersect the TIFF raster');
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

export function pixelAtCoordinate(transform: GeoTransform, width: number, height: number, lon: number, lat: number): { x: number; y: number } | null {
  validateNorthUp(transform);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const x = Math.floor((lon - transform[0]) / transform[1]);
  const y = Math.floor((lat - transform[3]) / transform[5]);
  return x >= 0 && y >= 0 && x < width && y < height ? { x, y } : null;
}

export interface TileGrid {
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  columns: number;
}

export function assembleWindow(grid: TileGrid, window: PixelWindow, tiles: Map<number, Float32Array>): Float32Array {
  const output = new Float32Array(window.width * window.height);
  const rows = Math.ceil(grid.height / grid.tileHeight);
  if (grid.columns !== Math.ceil(grid.width / grid.tileWidth) || rows <= 0) throw new Error('Invalid TIFF tile grid');
  for (let y = 0; y < window.height; y++) for (let x = 0; x < window.width; x++) {
    const sourceX = window.x + x;
    const sourceY = window.y + y;
    if (sourceX < 0 || sourceY < 0 || sourceX >= grid.width || sourceY >= grid.height) throw new RangeError('Raster window is outside the tile grid');
    const tileX = Math.floor(sourceX / grid.tileWidth);
    const tileY = Math.floor(sourceY / grid.tileHeight);
    const index = tileY * grid.columns + tileX;
    const tile = tiles.get(index);
    if (!tile || tile.length !== grid.tileWidth * grid.tileHeight) throw new Error(`Missing or invalid decoded tile ${index}`);
    const tilePixel = (sourceY % grid.tileHeight) * grid.tileWidth + (sourceX % grid.tileWidth);
    output[y * window.width + x] = tile[tilePixel]!;
  }
  return output;
}

const PALETTE: ReadonlyArray<readonly [number, readonly [number, number, number]]> = [
  [-11000, [9, 31, 58]],
  [-5000, [36, 107, 141]],
  [-1000, [114, 182, 188]],
  [0, [234, 234, 218]],
  [1000, [100, 151, 104]],
  [5000, [211, 176, 112]],
  [9000, [246, 236, 194]],
];

export function elevationColor(value: number, nodata = -99999): [number, number, number, number] {
  if (!Number.isFinite(value) || value === nodata) return [0, 0, 0, 0];
  if (value <= PALETTE[0]![0]) return [...PALETTE[0]![1], 255];
  if (value >= PALETTE.at(-1)![0]) return [...PALETTE.at(-1)![1], 255];
  for (let i = 1; i < PALETTE.length; i++) {
    const high = PALETTE[i]!;
    const low = PALETTE[i - 1]!;
    if (value <= high[0]) {
      const t = (value - low[0]) / (high[0] - low[0]);
      return [
        Math.round(low[1][0] + (high[1][0] - low[1][0]) * t),
        Math.round(low[1][1] + (high[1][1] - low[1][1]) * t),
        Math.round(low[1][2] + (high[1][2] - low[1][2]) * t),
        255,
      ];
    }
  }
  throw new Error('Elevation palette lookup failed');
}

export interface RasterViewState {
  bounds: [number, number, number, number];
  selected: { lon: number; lat: number; value: number } | null;
}

export function serializeRasterView(state: RasterViewState): string {
  return JSON.stringify(state);
}

export function parseRasterView(json: string): RasterViewState {
  const value: unknown = JSON.parse(json);
  if (!value || typeof value !== 'object') throw new Error('Invalid raster view state');
  const state = value as RasterViewState;
  if (!Array.isArray(state.bounds) || state.bounds.length !== 4 || !state.bounds.every(Number.isFinite) || state.bounds[2] <= state.bounds[0] || state.bounds[3] <= state.bounds[1]) {
    throw new Error('Invalid raster view bounds');
  }
  if (state.selected !== null && (!state.selected || !Number.isFinite(state.selected.lon) || !Number.isFinite(state.selected.lat) || !Number.isFinite(state.selected.value))) {
    throw new Error('Invalid selected raster sample');
  }
  return state;
}
