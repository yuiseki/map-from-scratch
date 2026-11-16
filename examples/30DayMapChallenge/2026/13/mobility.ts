export interface Municipality {
  code: string;
  name: string;
  prefecture: string;
  lon: number;
  lat: number;
}

export interface MobilityFrame {
  year: number;
  month: number;
  municipalityCount: number;
  /** Municipality-major, then weekday/holiday/all, daytime/late-night/all-day, residence-area category. */
  flows: Uint32Array;
}

const DAY_TYPES = 3, TIMEZONES = 3, CATEGORIES = 4;
const HEADER_BYTES = 16;

export function flowOffset(city: number, dayType: number, timezone: number, category: number): number {
  if (![city, dayType, timezone, category].every(Number.isInteger) || city < 0 || dayType < 0 || dayType >= DAY_TYPES
    || timezone < 0 || timezone >= TIMEZONES || category < 0 || category >= CATEGORIES) throw new RangeError('invalid mobility flow index');
  return (((city * DAY_TYPES + dayType) * TIMEZONES + timezone) * CATEGORIES) + category;
}

export function categoryShare(values: readonly number[]): number[] | null {
  if (values.length !== CATEGORIES || values.some((value) => !Number.isFinite(value) || value < 0)) throw new RangeError('invalid category values');
  const total = values.reduce((sum, value) => sum + value, 0);
  return total > 0 ? values.map((value) => value / total) : null;
}

export function encodeMobilityFrame(frame: MobilityFrame): ArrayBuffer {
  if (!Number.isInteger(frame.year) || frame.year < 2019 || frame.year > 2021 || !Number.isInteger(frame.month) || frame.month < 0 || frame.month >= 12
    || !Number.isInteger(frame.municipalityCount) || frame.municipalityCount < 1
    || frame.flows.length !== frame.municipalityCount * DAY_TYPES * TIMEZONES * CATEGORIES) throw new Error('invalid mobility frame dimensions');
  const bytes = new ArrayBuffer(HEADER_BYTES + frame.flows.length * 4), view = new DataView(bytes);
  view.setUint32(0, 0x3152464d, true); // MFR1
  view.setUint32(4, frame.municipalityCount, true);
  view.setUint16(8, frame.year, true); view.setUint8(10, frame.month);
  view.setUint8(11, DAY_TYPES); view.setUint8(12, TIMEZONES); view.setUint8(13, CATEGORIES);
  for (let i = 0; i < frame.flows.length; i++) view.setUint32(HEADER_BYTES + i * 4, frame.flows[i]!, true);
  return bytes;
}

export function decodeMobilityFrame(bytes: ArrayBuffer): MobilityFrame {
  if (bytes.byteLength < HEADER_BYTES) throw new Error('truncated MFR1 mobility header');
  const view = new DataView(bytes), count = view.getUint32(4, true);
  const year = view.getUint16(8, true), month = view.getUint8(10);
  if (view.getUint32(0, true) !== 0x3152464d || count < 1 || year < 2019 || year > 2021 || month > 11
    || view.getUint8(11) !== DAY_TYPES || view.getUint8(12) !== TIMEZONES || view.getUint8(13) !== CATEGORIES) throw new Error('invalid MFR1 mobility header');
  const valueCount = count * DAY_TYPES * TIMEZONES * CATEGORIES;
  if (bytes.byteLength !== HEADER_BYTES + valueCount * 4) throw new Error('invalid MFR1 mobility length');
  const flows = new Uint32Array(valueCount);
  for (let i = 0; i < valueCount; i++) flows[i] = view.getUint32(HEADER_BYTES + i * 4, true);
  return { year, month, municipalityCount: count, flows };
}
