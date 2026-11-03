export function parseTileRings(buffer: ArrayBuffer, byteOffset = 0, byteLength = buffer.byteLength - byteOffset): Float32Array[] {
  const view = new DataView(buffer, byteOffset, byteLength);
  if (byteLength < 2) throw new Error('truncated tile ring header');
  const count = view.getUint16(0, true);
  const rings: Float32Array[] = [];
  let offset = 2;
  for (let r = 0; r < count; r++) {
    if (offset + 2 > byteLength) throw new Error('truncated tile ring header');
    const points = view.getUint16(offset, true);
    offset += 2;
    if (offset + points * 4 > byteLength) throw new Error('truncated tile ring points');
    const ring = new Float32Array(points * 2);
    for (let p = 0; p < points; p++) {
      ring[p * 2] = view.getUint16(offset, true) / 4096;
      ring[p * 2 + 1] = view.getUint16(offset + 2, true) / 4096;
      offset += 4;
    }
    rings.push(ring);
  }
  return rings;
}
