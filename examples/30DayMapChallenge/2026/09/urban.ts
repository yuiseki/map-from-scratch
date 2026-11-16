export interface UrbanCell {
  longitude: number;
  latitude: number;
  population: number;
  builtSurfaceM2: number;
}
export interface UrbanMetrics {
  populationPerKm2: number;
  builtShare: number;
  cellAreaKm2: number;
}
export interface UrbanExtent { west: number; east: number; south: number; north: number }

const EARTH_RADIUS_M = 6_371_008.8;
export const URBAN_RECORD_BYTES = 8;
export const URBAN_EXTENT: UrbanExtent = { west: 122, east: 146, south: 29.0995, north: 46 };
export function cellAreaKm2(latitude: number, angularSeconds = 30): number {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(angularSeconds) || angularSeconds <= 0) {
    throw new Error('Invalid latitude or angular cell size');
  }
  const halfSpan = angularSeconds / 3600 * Math.PI / 360;
  const longitudeSpan = halfSpan * 2;
  const north = (latitude * Math.PI / 180) + halfSpan;
  const south = (latitude * Math.PI / 180) - halfSpan;
  return (EARTH_RADIUS_M ** 2 * longitudeSpan * (Math.sin(north) - Math.sin(south))) / 1_000_000;
}

export function urbanMetrics(latitude: number, population: number, builtSurfaceM2: number): UrbanMetrics {
  if (!Number.isFinite(population) || !Number.isFinite(builtSurfaceM2) || population < 0 || builtSurfaceM2 < 0) {
    throw new Error('GHSL values must be finite and nonnegative');
  }
  const area = cellAreaKm2(latitude);
  const areaM2 = area * 1_000_000;
  return { populationPerKm2: population / area, builtShare: Math.min(1, builtSurfaceM2 / areaM2), cellAreaKm2: area };
}

function quantizeCoordinate(value: number, minimum: number, maximum: number): number {
  if (value < minimum || value > maximum) throw new Error('URB2 coordinate is outside its encoded extent');
  return Math.round((value - minimum) / (maximum - minimum) * 0xffff);
}

export function encodeUrbanCells(cells: readonly UrbanCell[], extent: UrbanExtent): ArrayBuffer {
  if (cells.length > 0xffff_ffff) throw new Error('URB2 has too many cells');
  const bytes = new ArrayBuffer(8 + cells.length * URBAN_RECORD_BYTES);
  const view = new DataView(bytes);
  for (let i = 0; i < 4; i++) view.setUint8(i, 'URB2'.charCodeAt(i));
  view.setUint32(4, cells.length, true);
  cells.forEach((cell, i) => {
    if (![cell.longitude, cell.latitude, cell.population, cell.builtSurfaceM2].every(Number.isFinite)
      || cell.population < 0 || cell.builtSurfaceM2 < 0) {
      throw new Error('URB2 values must be finite and source measures nonnegative');
    }
    if (cell.population > 0xffff || cell.builtSurfaceM2 > 0xffff * 10) throw new Error('URB2 measure exceeds its compact range');
    const offset = 8 + i * URBAN_RECORD_BYTES;
    view.setUint16(offset, quantizeCoordinate(cell.longitude, extent.west, extent.east), true);
    view.setUint16(offset + 2, quantizeCoordinate(cell.latitude, extent.south, extent.north), true);
    view.setUint16(offset + 4, cell.population > 0 ? Math.max(1, Math.round(cell.population)) : 0, true);
    view.setUint16(offset + 6, cell.builtSurfaceM2 > 0 ? Math.max(1, Math.round(cell.builtSurfaceM2 / 10)) : 0, true);
  });
  return bytes;
}

export function decodeUrbanCells(bytes: ArrayBuffer, extent: UrbanExtent): Float32Array {
  if (bytes.byteLength < 8) throw new Error('URB2 header is truncated');
  const view = new DataView(bytes);
  if (String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3)) !== 'URB2') {
    throw new Error('URB2 signature is invalid');
  }
  const count = view.getUint32(4, true);
  if (bytes.byteLength !== 8 + count * URBAN_RECORD_BYTES) throw new Error('URB2 record length does not match its header');
  const records = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const offset = 8 + i * URBAN_RECORD_BYTES;
    records[i * 4] = extent.west + view.getUint16(offset, true) / 0xffff * (extent.east - extent.west);
    records[i * 4 + 1] = extent.south + view.getUint16(offset + 2, true) / 0xffff * (extent.north - extent.south);
    records[i * 4 + 2] = view.getUint16(offset + 4, true);
    records[i * 4 + 3] = view.getUint16(offset + 6, true) * 10;
  }
  return records;
}
