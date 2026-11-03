export interface WeightedPoints {
  buffer: ArrayBuffer;
  count: number;
  bounds: readonly [number, number, number, number];
  totalWeight: number;
}

export function parseWeightedPoints(buffer: ArrayBuffer, magic: number, label: string): WeightedPoints {
  if (buffer.byteLength < 32) throw new Error(`truncated ${label} data`);
  const head = new DataView(buffer);
  if (head.getUint32(0, true) !== magic) throw new Error(`invalid ${label} data`);
  const count = head.getUint32(4, true);
  if (buffer.byteLength !== 32 + count * 6) throw new Error(`truncated ${label} data`);
  return {
    buffer, count,
    bounds: [head.getFloat32(8, true), head.getFloat32(12, true), head.getFloat32(16, true), head.getFloat32(20, true)],
    totalWeight: head.getUint32(24, true),
  };
}
