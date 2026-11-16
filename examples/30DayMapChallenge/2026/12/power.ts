const HEADER_BYTES = 10;
const MISSING = 0xffff;
const MAX_VALUE = 10_000;

export interface AccessRecord { iso3: string; values: (number | null)[] }
export interface AccessSeries { startYear: number; yearCount: number; records: AccessRecord[] }

export function encodeAccessSeries(records: readonly AccessRecord[], startYear: number): ArrayBuffer {
  if (!Number.isInteger(startYear) || startYear < 1900 || startYear > 2200) throw new Error('Invalid start year');
  const yearCount = records[0]?.values.length ?? 0;
  if (yearCount < 1 || startYear + yearCount > 2201 || records.length > 65_535) throw new Error('Invalid series dimensions');
  const seen = new Set<string>();
  for (const record of records) {
    if (!/^[A-Z]{3}$/.test(record.iso3)) throw new Error(`Invalid ISO3 country code: ${record.iso3}`);
    if (seen.has(record.iso3)) throw new Error(`Duplicate ISO3 country code: ${record.iso3}`);
    seen.add(record.iso3);
    if (record.values.length !== yearCount) throw new Error('Inconsistent country year count');
    for (const value of record.values) {
      if (value !== null && (!Number.isFinite(value) || value < 0 || value > 100)) throw new Error(`Invalid access percentage: ${value}`);
    }
  }
  const stride = 4 + yearCount * 2;
  const buffer = new ArrayBuffer(HEADER_BYTES + records.length * stride), view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, 'PWR1'.charCodeAt(i));
  view.setUint16(4, startYear, true); view.setUint16(6, yearCount, true); view.setUint16(8, records.length, true);
  let offset = HEADER_BYTES;
  for (const record of records) {
    for (let i = 0; i < 3; i++) view.setUint8(offset + i, record.iso3.charCodeAt(i));
    view.setUint8(offset + 3, 0);
    for (let year = 0; year < yearCount; year++) {
      const value = record.values[year];
      view.setUint16(offset + 4 + year * 2, value === null ? MISSING : Math.round(value * 100), true);
    }
    offset += stride;
  }
  return buffer;
}

export function decodeAccessSeries(buffer: ArrayBuffer): AccessSeries {
  if (buffer.byteLength < HEADER_BYTES) throw new Error('Truncated PWR1 header');
  const view = new DataView(buffer), magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4));
  const startYear = view.getUint16(4, true), yearCount = view.getUint16(6, true), count = view.getUint16(8, true);
  const stride = 4 + yearCount * 2;
  if (magic !== 'PWR1' || yearCount < 1 || startYear < 1900 || startYear + yearCount > 2201
    || HEADER_BYTES + count * stride !== buffer.byteLength) throw new Error('Invalid PWR1 data');
  const records: AccessRecord[] = [], seen = new Set<string>();
  for (let i = 0, offset = HEADER_BYTES; i < count; i++, offset += stride) {
    const iso3 = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2));
    if (!/^[A-Z]{3}$/.test(iso3) || seen.has(iso3) || view.getUint8(offset + 3) !== 0) throw new Error('Invalid PWR1 country record');
    seen.add(iso3);
    const values: (number | null)[] = [];
    for (let year = 0; year < yearCount; year++) {
      const value = view.getUint16(offset + 4 + year * 2, true);
      if (value !== MISSING && value > MAX_VALUE) throw new Error('Invalid PWR1 percentage');
      values.push(value === MISSING ? null : value / 100);
    }
    records.push({ iso3, values });
  }
  return { startYear, yearCount, records };
}

export type RGB = [number, number, number];
const COLOR_STOPS: readonly [number, RGB][] = [
  [0, [49, 19, 77]], [0.5, [211, 78, 70]], [1, [255, 211, 115]],
];
const NO_DATA: RGB = [81, 99, 112];

export function powerColor(value: number | null): RGB {
  if (value === null || !Number.isFinite(value)) return [...NO_DATA];
  const t = Math.max(0, Math.min(100, value)) / 100;
  const [low, high] = t <= 0.5 ? [COLOR_STOPS[0]!, COLOR_STOPS[1]!] : [COLOR_STOPS[1]!, COLOR_STOPS[2]!];
  const local = (t - low[0]) / (high[0] - low[0]);
  return [0, 1, 2].map((index) => Math.round(low[1][index]! + (high[1][index]! - low[1][index]!) * local)) as RGB;
}
