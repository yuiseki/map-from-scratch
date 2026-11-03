// points.bin: the bear sightings, grouped by year so that a year filter is a
// draw range, not a shader test or a re-upload.
//
//   0  "BR52"
//   4  count u32
//   8  firstYear u16, nYears u16
//   12 count per year u32 x nYears
//   .. u, v u16 interleaved per point (0..65535 across the terrain area, v south)

export interface Points { count: number; firstYear: number; yearCounts: Uint32Array; uv: Uint16Array }

const MAGIC = 'BR52';

export function encodePoints(pts: { u: number; v: number; year: number }[]): Uint8Array {
  const sorted = [...pts].sort((a, b) => a.year - b.year);
  const first = sorted.length ? sorted[0].year : 0;
  const nYears = sorted.length ? sorted[sorted.length - 1].year - first + 1 : 0;
  const head = 12 + 4 * nYears;
  const buf = new Uint8Array(head + 4 * sorted.length + ((head + 4 * sorted.length) % 4 ? 2 : 0));
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < 4; i++) buf[i] = MAGIC.charCodeAt(i);
  dv.setUint32(4, sorted.length, true);
  dv.setUint16(8, first, true);
  dv.setUint16(10, nYears, true);
  for (const p of sorted) dv.setUint32(12 + 4 * (p.year - first), dv.getUint32(12 + 4 * (p.year - first), true) + 1, true);
  const q = (t: number) => Math.max(0, Math.min(65535, Math.round(t * 65535)));
  sorted.forEach((p, i) => {
    dv.setUint16(head + 4 * i, q(p.u), true);
    dv.setUint16(head + 4 * i + 2, q(p.v), true);
  });
  return buf;
}

export function decodePoints(buf: ArrayBuffer): Points {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(...new Uint8Array(buf, 0, 4));
  if (magic !== MAGIC) throw new Error(`points.bin: bad magic ${magic}`);
  const count = dv.getUint32(4, true), firstYear = dv.getUint16(8, true), nYears = dv.getUint16(10, true);
  const yearCounts = new Uint32Array(nYears);
  for (let i = 0; i < nYears; i++) yearCounts[i] = dv.getUint32(12 + 4 * i, true);
  return { count, firstYear, yearCounts, uv: new Uint16Array(buf, 12 + 4 * nYears, 2 * count) };
}

/** [first, end) of the points of `year`; year 0 means all years. */
export function yearRange(p: Points, year: number): [number, number] {
  if (year === 0) return [0, p.count];
  const k = year - p.firstYear;
  if (k < 0 || k >= p.yearCounts.length) return [0, 0];
  let start = 0;
  for (let i = 0; i < k; i++) start += p.yearCounts[i];
  return [start, start + p.yearCounts[k]];
}
