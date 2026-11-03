import type { BuildingsData, TripsData } from './render.ts';

export function decodeBuildingVertices(data: Pick<BuildingsData, 'buffer' | 'count'>): Float32Array {
  const raw = new DataView(data.buffer, 32, data.count * 8);
  const vertices = new Float32Array(data.count * 4);
  for (let i = 0; i < data.count; i++) {
    const src = i * 8, dst = i * 4;
    vertices[dst] = raw.getUint16(src, true);
    vertices[dst + 1] = raw.getUint16(src + 2, true);
    vertices[dst + 2] = raw.getUint16(src + 4, true);
    vertices[dst + 3] = raw.getUint8(src + 6) / 255;
  }
  return vertices;
}

export function decodeTripSegments(data: Pick<TripsData, 'buffer' | 'count'>): Uint32Array {
  const raw = new DataView(data.buffer, 32);
  const segments = new Uint32Array(Math.max(0, data.count - 1) * 8);
  const read24 = (offset: number): number => raw.getUint8(offset) + raw.getUint8(offset + 1) * 256 + raw.getUint8(offset + 2) * 65536;
  for (let i = 0; i < data.count - 1; i++) {
    const a = i * 10, b = (i + 1) * 10, dst = i * 8;
    segments[dst] = read24(a);
    segments[dst + 1] = read24(a + 3);
    segments[dst + 2] = raw.getUint16(a + 6, true);
    segments[dst + 3] = read24(b);
    segments[dst + 4] = read24(b + 3);
    segments[dst + 5] = raw.getUint16(b + 6, true);
    segments[dst + 6] = raw.getUint8(a + 8);
    segments[dst + 7] = raw.getUint8(a + 9);
  }
  return segments;
}
