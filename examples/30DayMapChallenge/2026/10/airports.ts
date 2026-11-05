export type AirportType = 'large_airport' | 'medium_airport' | 'small_airport' | 'heliport' | 'seaplane_base' | 'balloonport';
export interface Airport { lon: number; lat: number; type: string; scheduled: boolean }
export interface EncodedAirport { x: number; y: number; kind: number; scheduled: boolean }

const RAD = Math.PI / 180;
const X_EXTENT = 2.7066;
const Y_EXTENT = 1.3174;
const SQRT3_HALF = Math.sqrt(3) / 2;
const TYPE_ID: Record<AirportType, number> = {
  large_airport: 0, medium_airport: 1, small_airport: 2,
  seaplane_base: 3, heliport: 4, balloonport: 5,
};

/** Equal Earth projection, returned in a normalized 0..1 world box. */
export function projectAirport(lon: number, lat: number): [number, number] {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
    throw new Error(`Invalid airport coordinate: ${lon}, ${lat}`);
  }
  const phi = lat * RAD;
  const theta = Math.asin(SQRT3_HALF * Math.sin(phi));
  const theta2 = theta * theta;
  const theta6 = theta2 * theta2 * theta2;
  const denominator = 1.340264 + -0.081106 * theta2 + 0.000893 * theta6 + 0.003796 * theta6 * theta2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(theta)) / (3 * denominator);
  const y = theta * (1.340264 + -0.081106 * theta2 + 0.000893 * theta6 + 0.003796 * theta6 * theta2);
  return [x / (2 * X_EXTENT) + 0.5, 0.5 - y / (2 * Y_EXTENT)];
}

/** Four-byte header followed by six-byte lon/lat/type/service records. */
export function encodeAirports(airports: Airport[]): ArrayBuffer {
  if (airports.length > 0xffffffff) throw new Error('Too many airports to encode');
  const buffer = new ArrayBuffer(4 + airports.length * 6);
  const view = new DataView(buffer);
  view.setUint32(0, airports.length, true);
  airports.forEach((airport, index) => {
    const kind = TYPE_ID[airport.type as AirportType];
    if (kind === undefined) throw new Error(`Unsupported airport type: ${airport.type}`);
    const [x, y] = projectAirport(airport.lon, airport.lat);
    const offset = 4 + index * 6;
    view.setUint16(offset, Math.round(x * 65535), true);
    view.setUint16(offset + 2, Math.round(y * 65535), true);
    view.setUint8(offset + 4, kind);
    view.setUint8(offset + 5, airport.scheduled ? 1 : 0);
  });
  return buffer;
}

export function decodeAirports(buffer: ArrayBuffer): EncodedAirport[] {
  if (buffer.byteLength < 4) throw new Error('Truncated airport buffer header');
  const view = new DataView(buffer);
  const count = view.getUint32(0, true);
  if (buffer.byteLength !== 4 + count * 6) throw new Error('Airport buffer length does not match its record count');
  const result: EncodedAirport[] = [];
  for (let i = 0; i < count; i++) {
    const offset = 4 + i * 6;
    const x = view.getUint16(offset, true) / 65535;
    const y = view.getUint16(offset + 2, true) / 65535;
    const kind = view.getUint8(offset + 4);
    const scheduled = view.getUint8(offset + 5);
    if (kind > 5 || scheduled > 1) throw new Error('Invalid airport record class');
    result.push({ x, y, kind, scheduled: scheduled === 1 });
  }
  return result;
}

export const airportTypeLabels = ['大規模空港', '中規模空港', '小規模空港', '水上飛行場', 'ヘリポート', '気球飛行場'] as const;
export const airportTypeColors = ['#f4a261', '#e88750', '#d66a4d', '#76c9c2', '#98c8dc', '#f1d27a'] as const;
export const airportTypeRadii = [3.2, 2.4, 1.5, 1.3, 1.1, 1.2] as const;
