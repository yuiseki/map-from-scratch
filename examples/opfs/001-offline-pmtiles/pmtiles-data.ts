const TZ = [0, 1, 5, 21, 85, 341, 1365];

export interface TileEntry { offset: number; length: number }

export function zxyToTileId(z: number, x: number, y: number): number {
  const n = 1 << z;
  let d = 0, xx = x, yy = y;
  for (let s = n >> 1; s >= 1; s >>= 1) {
    const rx = (xx & s) ? 1 : 0;
    const ry = (yy & s) ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { xx = s - 1 - xx; yy = s - 1 - yy; }
      const t = xx; xx = yy; yy = t;
    }
  }
  return TZ[z] + d;
}

function readVarint(bytes: Uint8Array, cursor: { pos: number }): number {
  let value = 0, shift = 1, byte: number;
  do {
    if (cursor.pos >= bytes.length || shift > 2 ** 49) throw new Error('truncated PMTiles directory varint');
    byte = bytes[cursor.pos++];
    value += (byte & 0x7f) * shift;
    shift *= 128;
  } while (byte & 0x80);
  return value;
}

export function parseDirectory(bytes: Uint8Array): Map<number, TileEntry> {
  const cursor = { pos: 0 };
  const count = readVarint(bytes, cursor);
  const ids: number[] = [], runLengths: number[] = [], lengths: number[] = [], offsets: number[] = [];
  let last = 0;
  for (let i = 0; i < count; i++) { last += readVarint(bytes, cursor); ids.push(last); }
  for (let i = 0; i < count; i++) runLengths.push(readVarint(bytes, cursor));
  for (let i = 0; i < count; i++) lengths.push(readVarint(bytes, cursor));
  for (let i = 0; i < count; i++) {
    const encoded = readVarint(bytes, cursor);
    offsets.push(encoded === 0 && i > 0 ? offsets[i - 1] + lengths[i - 1] : encoded - 1);
  }
  const entries = new Map<number, TileEntry>();
  for (let i = 0; i < count; i++) entries.set(ids[i], { offset: offsets[i], length: lengths[i] });
  return entries;
}
