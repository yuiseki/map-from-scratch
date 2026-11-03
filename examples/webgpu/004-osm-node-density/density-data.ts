import { decodeDensityData } from '../../04-osm-node-density/decode.ts';

export interface PackedDensityData { count: number; bbox: Float64Array; points: Uint32Array }

export function decodePackedDensity(buffer: ArrayBuffer, stride = 128): PackedDensityData {
  const { count, bbox, positions } = decodeDensityData(buffer, stride);
  const points = new Uint32Array(count);
  for (let i = 0; i < count; i++) points[i] = positions[i * 2] | (positions[i * 2 + 1] << 16);
  return { count, bbox, points };
}
