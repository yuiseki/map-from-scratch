export type TrackObservation = {
  sid: string;
  time: string;
  lon: number;
  lat: number;
  basin: string;
};

export type Segment = { a: [number, number]; b: [number, number]; basin: string };

const BASINS = ['EP', 'NA', 'NI', 'SA', 'SI', 'SP', 'WP'] as const;
const basinIndex = new Map<string, number>(BASINS.map((basin, index) => [basin, index]));
const RAD = Math.PI / 180;
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;

export function projectEarth(lon: number, lat: number): [number, number] {
  const t = Math.asin(M * Math.sin(lat * RAD));
  const t2 = t * t, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = t * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
  return [x, y];
}

export function splitAntimeridian(a: [number, number], b: [number, number], basin: string): Segment[] {
  if (Math.abs(a[0] - b[0]) <= 180) return [{ a, b, basin }];
  const eastward = a[0] > 0;
  const edgeA = eastward ? 180 : -180;
  const edgeB = -edgeA;
  const adjustedB = b[0] + (eastward ? 360 : -360);
  const t = (edgeA - a[0]) / (adjustedB - a[0]);
  const lat = a[1] + (b[1] - a[1]) * t;
  return [
    { a, b: [edgeA, lat], basin },
    { a: [edgeB, lat], b, basin },
  ];
}

export function makeSegments(observations: TrackObservation[]): Segment[] {
  const valid = observations.map((row) => ({
    ...row,
    lon: row.lon > 180 && row.lon <= 360 ? row.lon - 360 : row.lon,
  })).filter((row) => row.sid && row.time && row.basin
    && Number.isFinite(row.lon) && row.lon >= -180 && row.lon <= 180
    && Number.isFinite(row.lat) && row.lat >= -90 && row.lat <= 90);
  valid.sort((a, b) => a.sid.localeCompare(b.sid) || a.time.localeCompare(b.time));
  const result: Segment[] = [];
  let previous: TrackObservation | undefined;
  for (const row of valid) {
    if (previous?.sid === row.sid && (previous.lon !== row.lon || previous.lat !== row.lat)) {
      result.push(...splitAntimeridian([previous.lon, previous.lat], [row.lon, row.lat], previous.basin));
    }
    previous = row;
  }
  return result;
}

export function encodeSegments(segments: Segment[]): ArrayBuffer {
  const buffer = new ArrayBuffer(4 + segments.length * 12);
  const view = new DataView(buffer);
  view.setUint32(0, segments.length, true);
  segments.forEach((segment, index) => {
    const offset = 4 + index * 12;
    const coords = [...segment.a, ...segment.b];
    coords.forEach((value, i) => {
      const normalized = i % 2 === 0 ? (value + 180) / 360 : (90 - value) / 180;
      view.setUint16(offset + i * 2, Math.max(0, Math.min(65535, Math.round(normalized * 65535))), true);
    });
    const basin = basinIndex.get(segment.basin);
    if (basin === undefined) throw new Error(`Unknown IBTrACS basin: ${segment.basin}`);
    view.setUint8(offset + 8, basin);
  });
  return buffer;
}
