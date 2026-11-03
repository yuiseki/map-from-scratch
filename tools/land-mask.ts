import { deflateSync } from 'node:zlib';

export type LandPolygons = readonly (readonly (readonly (readonly [number, number])[])[])[];

export function rasterizePolygons(polygons: LandPolygons, width: number, height: number): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new Error('mask dimensions must be positive integers');
  const mask = new Uint8Array(width * height);
  for (const rings of polygons) {
    let minY = 1, maxY = 0;
    for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const firstRow = Math.max(0, Math.ceil(minY * height - 0.5));
    const lastRow = Math.min(height, Math.ceil(maxY * height - 0.5));
    for (let row = firstRow; row < lastRow; row++) {
      const scanY = (row + 0.5) / height;
      const intersections: number[] = [];
      for (const ring of rings) {
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x0, y0] = ring[j], [x1, y1] = ring[i];
          if ((y0 <= scanY && y1 > scanY) || (y1 <= scanY && y0 > scanY)) {
            intersections.push(x0 + (scanY - y0) * (x1 - x0) / (y1 - y0));
          }
        }
      }
      intersections.sort((a, b) => a - b);
      for (let i = 0; i + 1 < intersections.length; i += 2) {
        const start = Math.max(0, Math.ceil(intersections[i] * width - 0.5));
        const end = Math.min(width, Math.ceil(intersections[i + 1] * width - 0.5));
        if (end > start) mask.fill(255, row * width + start, row * width + end);
      }
    }
  }
  return mask;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4); out.set(body, 8);
  view.setUint32(body.length + 8, crc32(out.subarray(4, body.length + 8)));
  return out;
}

export function encodeGrayPng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || pixels.length !== width * height) {
    throw new Error('pixel data must match positive PNG dimensions');
  }
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, width); h.setUint32(4, height);
  header[8] = 8; header[9] = 0; header[10] = 0; header[11] = 0; header[12] = 0;
  const rows = new Uint8Array(height * (width + 1));
  for (let y = 0; y < height; y++) rows.set(pixels.subarray(y * width, (y + 1) * width), y * (width + 1) + 1);
  const parts = [
    new Uint8Array([137,80,78,71,13,10,26,10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', new Uint8Array()),
  ];
  const png = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { png.set(part, offset); offset += part.length; }
  return png;
}
