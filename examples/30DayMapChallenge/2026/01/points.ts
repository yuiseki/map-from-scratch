const X_EXTENT = 2.7066;
const Y_EXTENT = 1.3174;
const RAD = Math.PI / 180;
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;

// Small renderer-local projection: tools/geo.ts also imports earcut for bake-time
// polygon work, which must not become a browser runtime dependency here.
export function projectEarth(lon: number, lat: number): [number, number] {
  const t = Math.asin(M * Math.sin(lat * RAD));
  const t2 = t * t, t6 = t2 * t2 * t2;
  const x = (2 * Math.sqrt(3) * lon * RAD * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1));
  const y = t * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1);
  return [x, y];
}

export function projectPoint(
  lon: number, lat: number, width: number, height: number,
  zoom = 1, centerX = 0, centerY = 0,
): [number, number] {
  const [x, y] = projectEarth(lon, lat);
  const scale = Math.min(width / (2 * X_EXTENT), height / (2 * Y_EXTENT)) * zoom;
  return [width / 2 + (x - centerX) * scale, height / 2 - (y - centerY) * scale];
}

export function markerRadius(magnitude: number): number {
  return Math.min(14, 2 * 2 ** (magnitude - 4.5));
}

export function depthColor(depthKm: number): string {
  if (depthKm < 70) return '#ff624d';
  if (depthKm <= 300) return '#ffc857';
  return '#67b7ff';
}

export interface QuakePoint {
  lon: number;
  lat: number;
  magnitude: number;
  depthKm: number;
}

/** Pack points as a count header followed by 8-byte GPU-ready records. */
export function encodePoints(points: QuakePoint[]): ArrayBuffer {
  const ordered = points.slice().sort((a, b) => a.magnitude - b.magnitude);
  const buffer = new ArrayBuffer(4 + ordered.length * 8);
  const view = new DataView(buffer);
  view.setUint32(0, ordered.length, true);
  ordered.forEach((point, i) => {
    const [x, y] = projectEarth(point.lon, point.lat);
    const offset = 4 + i * 8;
    view.setUint16(offset, Math.round(((x + X_EXTENT) / (2 * X_EXTENT)) * 65535), true);
    view.setUint16(offset + 2, Math.round(((Y_EXTENT - y) / (2 * Y_EXTENT)) * 65535), true);
    view.setUint8(offset + 4, Math.round(markerRadius(point.magnitude) * 4));
    view.setUint8(offset + 5, point.depthKm < 70 ? 0 : point.depthKm <= 300 ? 1 : 2);
  });
  return buffer;
}
