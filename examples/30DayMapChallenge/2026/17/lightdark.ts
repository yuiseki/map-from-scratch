export interface Bounds { west: number; east: number; south: number; north: number }
export interface PresenceMesh extends Bounds { id: string; daytime: number | null; lateNight: number | null }
export interface PresenceMap { bounds: Bounds; year: number; month: number; dayflag: '2'; maximum: number; meshes: PresenceMesh[] }
export interface ScreenPoint { x: number; y: number }
export type Direction = 'left' | 'right' | 'up' | 'down';

export function sharedMaximum(map: PresenceMap): number {
  return map.meshes.reduce((max, mesh) => Math.max(max, mesh.daytime ?? 0, mesh.lateNight ?? 0), 0);
}

export function populationIntensity(value: number | null, maximum: number): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Population scale value must be non-negative');
  if (!Number.isFinite(maximum) || maximum < value) throw new RangeError('Shared population maximum must cover the value');
  if (maximum === 0) return 0;
  return Math.log1p(value) / Math.log1p(maximum);
}

export function localProjection(bounds: Bounds, left: number, top: number, width: number, height: number): (lon: number, lat: number) => ScreenPoint {
  if (!(bounds.west < bounds.east && bounds.south < bounds.north) || width <= 0 || height <= 0) throw new RangeError('Invalid projection bounds or dimensions');
  const meanLat = (bounds.south + bounds.north) / 2;
  const eastWest = (bounds.east - bounds.west) * Math.cos(meanLat * Math.PI / 180);
  const northSouth = bounds.north - bounds.south;
  const scale = Math.min(width / eastWest, height / northSouth);
  const usedWidth = eastWest * scale, usedHeight = northSouth * scale;
  const offsetX = left + (width - usedWidth) / 2;
  const offsetY = top + (height - usedHeight) / 2;
  return (lon, lat) => ({
    x: offsetX + (lon - bounds.west) * Math.cos(meanLat * Math.PI / 180) * scale,
    y: offsetY + (bounds.north - lat) * scale,
  });
}

export function findMeshAt(map: PresenceMap, lon: number, lat: number): PresenceMesh | null {
  if (lon < map.bounds.west || lon > map.bounds.east || lat < map.bounds.south || lat > map.bounds.north) return null;
  return map.meshes.find((mesh) => lon >= mesh.west && lon <= mesh.east && lat >= mesh.south && lat <= mesh.north) ?? null;
}

export function meshAtScreenPoint(map: PresenceMap, project: (lon: number, lat: number) => ScreenPoint, x: number, y: number): PresenceMesh | null {
  let hit: PresenceMesh | null = null, nearest = Infinity;
  for (const mesh of map.meshes) {
    const northwest = project(mesh.west, mesh.north), southeast = project(mesh.east, mesh.south);
    if (x < northwest.x || x > southeast.x || y < northwest.y || y > southeast.y) continue;
    const centerX = (northwest.x + southeast.x) / 2, centerY = (northwest.y + southeast.y) / 2;
    const distance = (x - centerX) ** 2 + (y - centerY) ** 2;
    if (distance < nearest) { nearest = distance; hit = mesh; }
  }
  return hit;
}

export function directionalNeighbor(map: PresenceMap, selectedId: string, direction: Direction): PresenceMesh | null {
  const current = map.meshes.find((mesh) => mesh.id === selectedId);
  if (!current) return map.meshes[0] ?? null;
  const originX = (current.west + current.east) / 2 * Math.cos(((current.south + current.north) / 2) * Math.PI / 180);
  const originY = (current.south + current.north) / 2;
  let best: PresenceMesh | null = null, score = Infinity;
  for (const candidate of map.meshes) {
    if (candidate.id === selectedId) continue;
    const x = (candidate.west + candidate.east) / 2 * Math.cos(((candidate.south + candidate.north) / 2) * Math.PI / 180);
    const y = (candidate.south + candidate.north) / 2;
    const dx = x - originX, dy = y - originY;
    if ((direction === 'left' && dx >= 0) || (direction === 'right' && dx <= 0) || (direction === 'up' && dy <= 0) || (direction === 'down' && dy >= 0)) continue;
    const primary = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    const candidateScore = primary + secondary * 2.5;
    if (candidateScore < score) { score = candidateScore; best = candidate; }
  }
  return best ?? current;
}

export function validatePresenceMap(map: PresenceMap): void {
  const { bounds } = map;
  if (!(bounds.west < bounds.east && bounds.south < bounds.north) || !Number.isFinite(bounds.west + bounds.east + bounds.south + bounds.north)) throw new Error('Invalid geographic bounds');
  if (!Number.isInteger(map.year) || map.year < 2019 || map.year > 2021 || !Number.isInteger(map.month) || map.month < 1 || map.month > 12 || map.dayflag !== '2') throw new Error('Invalid month or day selection');
  if (map.meshes.length === 0) throw new Error('Presence map has no mesh geometry');
  const ids = new Set<string>();
  for (const mesh of map.meshes) {
    if (!mesh.id || ids.has(mesh.id)) throw new Error(`duplicate mesh id ${mesh.id}`);
    ids.add(mesh.id);
    if (!(mesh.west < mesh.east && mesh.south < mesh.north) || mesh.west < bounds.west - 0.02 || mesh.east > bounds.east + 0.02 || mesh.south < bounds.south - 0.02 || mesh.north > bounds.north + 0.02) throw new Error(`Invalid mesh geometry ${mesh.id}`);
    for (const value of [mesh.daytime, mesh.lateNight]) if (value !== null && (!Number.isSafeInteger(value) || value < 10)) throw new Error(`Invalid population for mesh ${mesh.id}`);
  }
  const maximum = sharedMaximum(map);
  if (!Number.isSafeInteger(map.maximum) || map.maximum !== maximum || maximum < 10) throw new Error(`Invalid shared maximum: expected ${maximum}`);
}
