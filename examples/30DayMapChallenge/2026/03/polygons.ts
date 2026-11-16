export interface CountryMesh {
  /** Equal Earth projected vertices quantized to unsigned 16-bit coordinates. */
  vertices: [number, number, number][];
  triangles: number[];
  borders: [number, number][];
}

const RAD = Math.PI / 180;
const A1 = 1.340264, A2 = -0.081106, A3 = 0.000893, A4 = 0.003796;
const M = Math.sqrt(3) / 2;
export function projectEqualEarth(lon: number, lat: number): [number, number] {
  const t = Math.asin(M * Math.sin(lat * RAD));
  const t2 = t * t, t6 = t2 * t2 * t2;
  return [
    (2 * Math.sqrt(3) * lon * RAD * Math.cos(t)) / (3 * (9 * A4 * t6 * t2 + 7 * A3 * t6 + 3 * A2 * t2 + A1)),
    t * (A4 * t6 * t2 + A3 * t6 + A2 * t2 + A1),
  ];
}

export function populationClass(value: number | null, minimum: number, maximum: number): number {
  if (value === null || !Number.isFinite(value) || value <= 0) return 0;
  if (!(minimum > 0) || !(maximum >= minimum)) throw new Error('Population scale bounds must be positive and ordered');
  if (minimum === maximum) return 128;
  const t = Math.max(0, Math.min(1, (Math.log10(value) - Math.log10(minimum)) / (Math.log10(maximum) - Math.log10(minimum))));
  return 1 + Math.round(t * 254);
}

/** GPC1: header, six-byte per-vertex records, triangle indices, then border pairs. */
export function encodeCountryMesh(mesh: CountryMesh): ArrayBuffer {
  if (mesh.triangles.length % 3 !== 0) throw new Error('Triangle index count must be divisible by three');
  for (const index of [...mesh.triangles, ...mesh.borders.flat()]) {
    if (!Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) throw new Error(`Country mesh index out of range: ${index}`);
  }
  for (const [x, y, value] of mesh.vertices) {
    if (![x, y, value].every(Number.isInteger) || x < 0 || x > 65535 || y < 0 || y > 65535 || value < 0 || value > 255) {
      throw new Error('Invalid quantized country vertex');
    }
  }
  const borderIndexCount = mesh.borders.length * 2;
  const buffer = new ArrayBuffer(16 + mesh.vertices.length * 6 + mesh.triangles.length * 4 + borderIndexCount * 4);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x47, 0x50, 0x43, 0x31]); // GPC1
  const view = new DataView(buffer);
  view.setUint32(4, mesh.vertices.length, true);
  view.setUint32(8, mesh.triangles.length, true);
  view.setUint32(12, mesh.borders.length, true);
  let offset = 16;
  for (const [x, y, value] of mesh.vertices) {
    view.setUint16(offset, x, true); view.setUint16(offset + 2, y, true); view.setUint8(offset + 4, value);
    offset += 6;
  }
  for (const index of mesh.triangles) { view.setUint32(offset, index, true); offset += 4; }
  for (const edge of mesh.borders) {
    view.setUint32(offset, edge[0], true); view.setUint32(offset + 4, edge[1], true); offset += 8;
  }
  return buffer;
}
