export interface TerrainGrid { width: number; height: number; elevations: ArrayLike<number> }

export function encodeElevationGrid(grid: TerrainGrid): ArrayBuffer {
  const { width, height, elevations } = grid;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 65535 || height > 65535) throw new Error('Invalid terrain grid dimensions');
  if (elevations.length !== width * height) throw new Error(`Terrain elevation count ${elevations.length} does not match grid dimensions`);
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < elevations.length; i++) {
    const value = elevations[i]!;
    if (!Number.isFinite(value)) throw new Error('Terrain elevations must be finite');
    min = Math.min(min, value); max = Math.max(max, value);
  }
  if (max <= min) throw new Error('Terrain elevation range must be positive');
  const out = new ArrayBuffer(20 + elevations.length * 2), view = new DataView(out);
  for (const [i, byte] of [...'FJT1'].entries()) view.setUint8(i, byte.charCodeAt(0));
  view.setUint16(4, width, true); view.setUint16(6, height, true);
  view.setFloat32(8, min, true); view.setFloat32(12, max, true); view.setUint32(16, elevations.length, true);
  const range = max - min;
  for (let i = 0; i < elevations.length; i++) view.setUint16(20 + i * 2, Math.round((elevations[i]! - min) / range * 65535), true);
  return out;
}

export function makeGridIndices(width: number, height: number): Uint32Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width * height > 0xffffffff) throw new Error('Invalid terrain grid dimensions');
  const indices = new Uint32Array((width - 1) * (height - 1) * 6);
  let offset = 0;
  for (let y = 0; y < height - 1; y++) for (let x = 0; x < width - 1; x++) {
    const a = y * width + x, b = a + 1, c = a + width, d = c + 1;
    indices[offset++] = a; indices[offset++] = c; indices[offset++] = b;
    indices[offset++] = b; indices[offset++] = c; indices[offset++] = d;
  }
  return indices;
}
