export interface GeographicBounds {
  west: number; east: number; south: number; north: number;
}

export interface QuarterMesh extends GeographicBounds {
  code: string;
  longitude: number;
  latitude: number;
}

export type CellStatus = 'missing' | 'suppressed' | 'zero' | 'positive';

export interface NullCell extends QuarterMesh {
  status: CellStatus;
  value: number | null;
}

export interface CensusValueRow {
  code: string;
  rawValue: string;
}

const LAT_STEP = 0.125 / 60;
const LON_STEP = 0.1875 / 60;
const FIRST_QUADRANT_SIDE = 0.25 / 60;
const SECOND_QUADRANT_SIDE = FIRST_QUADRANT_SIDE / 2;
const QUADRANT_COORDS: Record<string, [number, number]> = {
  '1': [0, 0], '2': [0, 1], '3': [1, 0], '4': [1, 1],
};

function validateBounds(bounds: GeographicBounds): void {
  if (![bounds.west, bounds.east, bounds.south, bounds.north].every(Number.isFinite)
    || bounds.west >= bounds.east || bounds.south >= bounds.north
    || bounds.west < 100 || bounds.east > 180 || bounds.south < 0 || bounds.north > 90) {
    throw new Error('invalid geographic bounds');
  }
}

/** Decode e-Stat's 10-digit fourth-level (250 m) JIS mesh code. */
export function decodeQuarterMesh(code: string): QuarterMesh {
  if (!/^\d{10}$/.test(code)) throw new Error(`invalid 250 m mesh code: ${code}`);
  const firstLatitude = Number(code.slice(0, 2));
  const firstLongitude = Number(code.slice(2, 4));
  const secondLatitude = Number(code[4]);
  const secondLongitude = Number(code[5]);
  const thirdLatitude = Number(code[6]);
  const thirdLongitude = Number(code[7]);
  if (secondLatitude > 7 || secondLongitude > 7 || thirdLatitude > 9 || thirdLongitude > 9) {
    throw new Error(`invalid mesh digits: ${code}`);
  }
  const quadrants = [QUADRANT_COORDS[code[8]!], QUADRANT_COORDS[code[9]!]];
  if (!quadrants[0] || !quadrants[1]) throw new Error(`invalid subdivision digit: ${code}`);
  const baseSouth = (firstLatitude * 40 + secondLatitude * 5 + thirdLatitude * 0.5) / 60;
  const baseWest = 100 + firstLongitude + (secondLongitude * 7.5 + thirdLongitude * 0.75) / 60;
  const [firstRow, firstColumn] = quadrants[0];
  const [secondRow, secondColumn] = quadrants[1];
  const south = baseSouth + firstRow * FIRST_QUADRANT_SIDE + secondRow * SECOND_QUADRANT_SIDE;
  const west = baseWest + firstColumn * FIRST_QUADRANT_SIDE * 1.5 + secondColumn * SECOND_QUADRANT_SIDE * 1.5;
  const north = south + SECOND_QUADRANT_SIDE;
  const east = west + SECOND_QUADRANT_SIDE * 1.5;
  return { code, west, east, south, north, longitude: (west + east) / 2, latitude: (south + north) / 2 };
}

function encodeQuarterMesh(latitude: number, longitude: number): string {
  const firstLatitude = Math.floor(latitude * 1.5 + 1e-10);
  const firstLongitude = Math.floor(longitude) - 100;
  const latitudeMinutes = latitude * 60 - firstLatitude * 40;
  const longitudeMinutes = (longitude - Math.floor(longitude)) * 60;
  const secondLatitude = Math.floor(latitudeMinutes / 5 + 1e-9);
  const secondLongitude = Math.floor(longitudeMinutes / 7.5 + 1e-9);
  const thirdLatitude = Math.floor((latitudeMinutes - secondLatitude * 5) / 0.5 + 1e-8);
  const thirdLongitude = Math.floor((longitudeMinutes - secondLongitude * 7.5) / 0.75 + 1e-8);
  const baseSouth = (firstLatitude * 40 + secondLatitude * 5 + thirdLatitude * 0.5) / 60;
  const baseWest = 100 + firstLongitude + (secondLongitude * 7.5 + thirdLongitude * 0.75) / 60;
  const row = Math.max(0, Math.min(3, Math.floor((latitude - baseSouth) / SECOND_QUADRANT_SIDE + 1e-8)));
  const column = Math.max(0, Math.min(3, Math.floor((longitude - baseWest) / (SECOND_QUADRANT_SIDE * 1.5) + 1e-8)));
  const firstQuadrant = 1 + 2 * Math.floor(row / 2) + Math.floor(column / 2);
  const secondQuadrant = 1 + 2 * (row % 2) + (column % 2);
  return `${String(firstLatitude).padStart(2, '0')}${String(firstLongitude).padStart(2, '0')}`
    + `${secondLatitude}${secondLongitude}${thirdLatitude}${thirdLongitude}${firstQuadrant}${secondQuadrant}`;
}

/** Return every 250 m mesh whose center falls inside the requested window. */
export function enumerateMeshLattice(bounds: GeographicBounds): QuarterMesh[] {
  validateBounds(bounds);
  const minRow = Math.ceil(bounds.south / LAT_STEP - 0.5 - 1e-8);
  const maxRow = Math.floor(bounds.north / LAT_STEP - 0.5 + 1e-8);
  const minColumn = Math.ceil((bounds.west - 100) / LON_STEP - 0.5 - 1e-8);
  const maxColumn = Math.floor((bounds.east - 100) / LON_STEP - 0.5 + 1e-8);
  const cells: QuarterMesh[] = [];
  for (let row = minRow; row <= maxRow; row++) {
    const latitude = (row + 0.5) * LAT_STEP;
    for (let column = minColumn; column <= maxColumn; column++) {
      const longitude = 100 + (column + 0.5) * LON_STEP;
      const code = encodeQuarterMesh(latitude, longitude);
      cells.push(decodeQuarterMesh(code));
    }
  }
  return cells;
}

export function classifyValue(rawValue: string | undefined): CellStatus {
  if (rawValue === undefined) return 'missing';
  if (rawValue === '*') return 'suppressed';
  if (!/^(0|[1-9]\d*)$/.test(rawValue)) throw new Error(`invalid census value: ${rawValue}`);
  return rawValue === '0' ? 'zero' : 'positive';
}

/** Fill only lattice cells with no source row; never turn suppression into zero. */
export function materializeNullCells(bounds: GeographicBounds, rows: readonly CensusValueRow[]): NullCell[] {
  const lattice = enumerateMeshLattice(bounds);
  const latticeCodes = new Set(lattice.map((cell) => cell.code));
  const values = new Map<string, string>();
  for (const row of rows) {
    if (values.has(row.code)) throw new Error(`duplicate census mesh row: ${row.code}`);
    classifyValue(row.rawValue);
    if (latticeCodes.has(row.code)) values.set(row.code, row.rawValue);
  }
  return lattice.map((cell) => {
    const raw = values.get(cell.code);
    const status = classifyValue(raw);
    return { ...cell, status, value: status === 'positive' ? Number(raw) : null };
  });
}
