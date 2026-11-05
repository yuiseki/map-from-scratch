export type LonLat = readonly [number, number];
export type GlobePoint = readonly [number, number, number];
export interface HexCell { h3: string; population: number; polygons: LonLat[][] }
export interface HexGrid {
  release: string;
  cells: HexCell[];
  populationTotal: number;
  maximumPopulation: number;
}

export const MAX_POPULATION = 22_732_635;
const EARTH_RADIUS_M = 6_378_137;

export function decodeMercator(x: number, y: number): LonLat {
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new RangeError('Mercator coordinate must be finite');
  const lon = x / EARTH_RADIUS_M * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}

export function globePosition(lon: number, lat: number, radius = 1): GlobePoint {
  if (![lon, lat, radius].every(Number.isFinite) || lat < -90 || lat > 90 || radius <= 0) {
    throw new RangeError('Invalid longitude, latitude, or globe radius');
  }
  const lambda = lon * Math.PI / 180, phi = lat * Math.PI / 180, cosPhi = Math.cos(phi);
  return [radius * cosPhi * Math.cos(lambda), radius * Math.sin(phi), radius * cosPhi * Math.sin(lambda)];
}

export function antimeridianChordDistance(a: LonLat, b: LonLat): number {
  const p = globePosition(a[0], a[1]), q = globePosition(b[0], b[1]);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

export function populationIntensity(population: number): number {
  if (!Number.isFinite(population) || population < 0) throw new RangeError('Population must be finite and non-negative');
  if (population === 0) return 0;
  return Math.min(1, Math.log1p(population) / Math.log1p(MAX_POPULATION));
}

export function populationRadius(population: number): number {
  return 1.002 + 0.021 * populationIntensity(population);
}

export function populationTone(population: number): [number, number, number] {
  if (population === 0) return [29, 43, 55];
  const t = populationIntensity(population);
  const low = [50, 118, 153], high = [255, 218, 136];
  return low.map((channel, i) => Math.round(channel + (high[i]! - channel) * t)) as [number, number, number];
}

export function validateHexCells(cells: HexCell[]): void {
  if (!Array.isArray(cells) || cells.length === 0) throw new Error('Hex grid has no cells');
  const ids = new Set<string>();
  for (const cell of cells) {
    if (!/^[0-9a-f]{15}$/i.test(cell.h3) || ids.has(cell.h3)) throw new Error(`Invalid or duplicate H3 id ${cell.h3}`);
    ids.add(cell.h3);
    if (!Number.isSafeInteger(cell.population) || cell.population < 0) throw new Error(`Invalid population for H3 ${cell.h3}`);
    if (!Array.isArray(cell.polygons) || cell.polygons.length === 0) throw new Error(`H3 ${cell.h3} has no polygon parts`);
    for (const ring of cell.polygons) {
      if (!Array.isArray(ring) || ring.length < 3) throw new Error(`H3 ${cell.h3} has an invalid polygon ring`);
      for (const position of ring) {
        if (!Array.isArray(position) || position.length !== 2 || !position.every(Number.isFinite)
          || position[0] < -180.0001 || position[0] > 180.0001 || position[1] < -90 || position[1] > 90) {
          throw new Error(`Invalid coordinate in H3 ${cell.h3}`);
        }
      }
    }
  }
}

export function validateHexGrid(grid: HexGrid): void {
  if (grid.release !== '2023-11-01') throw new Error(`Unexpected Kontur release ${grid.release}`);
  validateHexCells(grid.cells);
  const total = grid.cells.reduce((sum, cell) => sum + cell.population, 0);
  const maximum = grid.cells.reduce((max, cell) => Math.max(max, cell.population), 0);
  if (!Number.isSafeInteger(grid.populationTotal) || grid.populationTotal !== total) throw new Error('Population total does not match cells');
  if (!Number.isSafeInteger(grid.maximumPopulation) || grid.maximumPopulation !== maximum) throw new Error('Maximum population does not match cells');
}
