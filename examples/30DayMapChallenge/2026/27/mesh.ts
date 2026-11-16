export type Bounds = { west: number; south: number; east: number; north: number };
export type PopulationStatus = 'count' | 'zero' | 'suppressed' | 'no-row' | 'unavailable';
export interface CensusCell {
  code: string;
  bounds: Bounds;
  status: PopulationStatus;
  value: number | null;
  rawValue?: string | null;
  source?: { table: string; field: string; prefecture: string; HTKSYORI: string | null; HTKSAKI: string | null; GASSAN: string | null } | null;
}
export interface ScreenRect { x: number; y: number; width: number; height: number }
export interface GpuCellProjection extends ScreenRect { visible: boolean; classIndex: number }

const SECOND_LAT_DEG = 5 / 60;
const SECOND_LON_DEG = 7.5 / 60;
const THIRD_LAT_DEG = 30 / 3600;
const THIRD_LON_DEG = 45 / 3600;

function quadrant(value: number): [number, number] | null {
  switch (value) {
    case 1: return [0, 0]; // south-west
    case 2: return [0, 1]; // south-east
    case 3: return [1, 0]; // north-west
    case 4: return [1, 1]; // north-east
    default: return null;
  }
}

/** Decode the standard 10-digit quarter-mesh code (JIS X 0410) exactly. */
export function decodeQuarterMesh(code: string): Bounds | null {
  if (!/^\d{10}$/.test(code)) return null;
  const digits = [...code].map(Number);
  const [q4, q5] = [quadrant(digits[8]), quadrant(digits[9])];
  if (!q4 || !q5) return null;
  const p = Number(code.slice(0, 2));
  const q = Number(code.slice(2, 4));
  const r = digits[4], s = digits[5], t = digits[6], u = digits[7];
  if (r > 7 || s > 7 || t > 9 || u > 9) return null;
  const south = p * (40 / 60) + r * SECOND_LAT_DEG + t * THIRD_LAT_DEG + (q4[0] * 2 + q5[0]) * THIRD_LAT_DEG / 4;
  const west = 100 + q + s * SECOND_LON_DEG + u * THIRD_LON_DEG + (q4[1] * 2 + q5[1]) * THIRD_LON_DEG / 4;
  return { west, south, east: west + THIRD_LON_DEG / 4, north: south + THIRD_LAT_DEG / 4 };
}

/** Encode an interior WGS84 position using the same 1/4 mesh rules. */
export function encodeQuarterMesh(lon: number, lat: number): string | null {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < 0 || lat >= 90 || lon < 100 || lon >= 200) return null;
  const p = Math.floor(lat * 1.5), q = Math.floor(lon) - 100;
  const latInPrimary = lat - p * (40 / 60);
  const lonInPrimary = lon - Math.floor(lon);
  const r = Math.floor(latInPrimary / SECOND_LAT_DEG), s = Math.floor(lonInPrimary / SECOND_LON_DEG);
  const latInSecond = latInPrimary - r * SECOND_LAT_DEG;
  const lonInSecond = lonInPrimary - s * SECOND_LON_DEG;
  const t = Math.min(9, Math.floor(latInSecond / THIRD_LAT_DEG));
  const u = Math.min(9, Math.floor(lonInSecond / THIRD_LON_DEG));
  const latQuarter = Math.min(3, Math.floor((latInSecond - t * THIRD_LAT_DEG) / (THIRD_LAT_DEG / 4)));
  const lonQuarter = Math.min(3, Math.floor((lonInSecond - u * THIRD_LON_DEG) / (THIRD_LON_DEG / 4)));
  const quadrantCode = (row: number, col: number) => (row >= 1 ? (col >= 1 ? 4 : 3) : (col >= 1 ? 2 : 1));
  const first = quadrantCode(Math.floor(latQuarter / 2), Math.floor(lonQuarter / 2));
  const second = quadrantCode(latQuarter % 2, lonQuarter % 2);
  return `${String(p).padStart(2, '0')}${String(q).padStart(2, '0')}${r}${s}${t}${u}${first}${second}`;
}

export function classifyPopulation(raw: string | null | undefined): { status: PopulationStatus; value: number | null } | null {
  if (raw === '*') return { status: 'suppressed', value: null };
  if (raw === null || raw === undefined || raw.trim() === '') return { status: 'unavailable', value: null };
  if (!/^\d+$/.test(raw.trim())) return { status: 'unavailable', value: null };
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return { status: value === 0 ? 'zero' : 'count', value };
}

export function populationForMesh(hasSourceRow: boolean, raw: string | null | undefined): { status: PopulationStatus; value: number | null } | null {
  if (!hasSourceRow) return { status: 'no-row', value: null };
  return classifyPopulation(raw);
}

export function serializeCensusCells(cells: CensusCell[]): string {
  return JSON.stringify(cells);
}

export function parseCensusCells(json: string): CensusCell[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) throw new Error('Census cells must be an array');
  return value.map((item: unknown, index: number) => {
    if (!item || typeof item !== 'object') throw new Error(`Invalid census cell ${index}`);
    const cell = item as CensusCell;
    const expected = decodeQuarterMesh(cell.code);
    if (!expected || !cell.bounds || ['west', 'south', 'east', 'north'].some((key) => Math.abs(cell.bounds[key as keyof Bounds] - expected[key as keyof Bounds]) > 1e-9)) {
      throw new Error(`Invalid mesh bounds for ${cell.code}`);
    }
    if (!['count', 'zero', 'suppressed', 'no-row', 'unavailable'].includes(cell.status)) throw new Error(`Invalid population status for ${cell.code}`);
    if (cell.status === 'count' && (typeof cell.rawValue !== 'string' || !/^\d+$/.test(cell.rawValue) || Number(cell.rawValue) !== cell.value || Number(cell.value) <= 0)) throw new Error(`Invalid raw value for ${cell.code}`);
    if (cell.status === 'zero' && (cell.rawValue !== '0' || cell.value !== 0)) throw new Error(`Invalid raw value for ${cell.code}`);
    if (cell.status === 'suppressed' && (cell.rawValue !== '*' || cell.value !== null)) throw new Error(`Invalid raw value for ${cell.code}`);
    if (cell.status === 'no-row' && (cell.rawValue !== null || cell.value !== null || cell.source !== null)) throw new Error(`Invalid no-row state for ${cell.code}`);
    if (cell.status === 'unavailable' && (cell.value !== null || cell.rawValue === null || cell.rawValue === undefined)) throw new Error(`Invalid unavailable state for ${cell.code}`);
    return cell;
  });
}

/** Positive-area intersection of a cell rectangle and a WGS84 rectangular selection. */
export function includeInArea(cell: Bounds, area: [number, number, number, number]): boolean {
  const [west, south, east, north] = area;
  return cell.east > west && cell.west < east && cell.north > south && cell.south < north;
}

type Position = [number, number];
export type PolygonRings = Position[][];

function inRing(point: Position, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    const cross = (point[0] - xi) * (yj - yi) - (point[1] - yi) * (xj - xi);
    const edgeScale = Math.max(1, Math.abs(xj - xi), Math.abs(yj - yi));
    if (Math.abs(cross) <= 1e-12 * edgeScale && point[0] >= Math.min(xi, xj) - 1e-12 && point[0] <= Math.max(xi, xj) + 1e-12 && point[1] >= Math.min(yi, yj) - 1e-12 && point[1] <= Math.max(yi, yj) + 1e-12) return true;
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when the cell centroid is inside the selected source polygon (holes excluded). */
export function cellCenterInPolygon(cell: Bounds, polygon: PolygonRings | PolygonRings[]): boolean {
  const polygons = polygon.length > 0 && Array.isArray(polygon[0][0]?.[0]) ? polygon as PolygonRings[] : [polygon as PolygonRings];
  const center: Position = [(cell.west + cell.east) / 2, (cell.south + cell.north) / 2];
  return polygons.some((rings) => rings.length > 0 && inRing(center, rings[0]) && !rings.slice(1).some((hole) => inRing(center, hole)));
}

/** CPU reference for the per-cell view projection/classification written by the WebGPU compute pass. */
export function projectCellForGpu(
  cell: CensusCell,
  view: [number, number, number, number],
  width: number,
  height: number,
  breaks: number[],
): GpuCellProjection {
  const [west, south, east, north] = view;
  const lat0 = (south + north) / 2;
  const cosLat = Math.cos(lat0 * Math.PI / 180);
  const viewWidth = Math.max((east - west) * cosLat, 1e-12);
  const viewHeight = Math.max(north - south, 1e-12);
  const cellBounds = cell.bounds;
  const x = ((cellBounds.west - west) * cosLat / viewWidth) * width;
  const right = ((cellBounds.east - west) * cosLat / viewWidth) * width;
  const y = ((north - cellBounds.north) / viewHeight) * height;
  const bottom = ((north - cellBounds.south) / viewHeight) * height;
  let classIndex = cell.status === 'no-row' ? 0 : cell.status === 'suppressed' ? breaks.length + 3 : cell.status === 'unavailable' ? breaks.length + 4 : cell.status === 'zero' ? 1 : 2;
  if (cell.status === 'count') {
    classIndex = 2;
    for (const threshold of breaks) if ((cell.value ?? 0) > threshold) classIndex++;
  }
  const rect = { x, y, width: right - x, height: bottom - y };
  const visible = right > 0 && x < width && bottom > 0 && y < height;
  return { ...rect, visible, classIndex };
}

export function featureAtScreenPoint(cells: CensusCell[], rects: ScreenRect[], x: number, y: number): number {
  // The bake is spatially ordered; reverse iteration makes the last cell own shared right/bottom edges.
  for (let i = cells.length - 1; i >= 0; i--) {
    const r = rects[i];
    if (r && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) return i;
  }
  return -1;
}

