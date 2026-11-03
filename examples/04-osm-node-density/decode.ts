export interface DensityData { count: number; bbox: Float64Array; positions: Uint16Array }

// Decode the baked Morton-ordered delta coordinates into GPU draw order.
export function decodeDensityData(bin: ArrayBuffer, stride = 128): DensityData {
  const count = new Uint32Array(bin, 0, 1)[0];
  const bbox = new Float64Array(bin, 8, 4);
  const dx = new Uint16Array(bin, 40, count), dy = new Uint16Array(bin, 40 + count * 2, count);
  const per = Math.ceil(count / stride), rem = count % stride || stride;
  const positions = new Uint16Array(count * 2);
  for (let i = 0, x = 0, y = 0; i < count; i++) {
    const r = i % stride, j = r * per - Math.max(0, r - rem) + Math.floor(i / stride);
    x = (x + dx[i]) & 0xffff;
    y = (y + dy[i]) & 0xffff;
    positions[2 * j] = x;
    positions[2 * j + 1] = y;
  }
  return { count, bbox, positions };
}
