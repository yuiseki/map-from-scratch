// Helper module for ArcLayer calculations and DARC decoding.

export interface FlowRecord {
  s: number;
  t: number;
  v: number;
}

export interface ArcDataset {
  countyCount: number;
  flowCount: number;
  centroids: Float32Array; // [lon0, lat0, lon1, lat1, ...]
  flows: FlowRecord[];
  landRings: Float32Array[];
  names: string[];
}

export function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

export function arcPoint(p0: [number, number], p1: [number, number], t: number, maxH: number): [number, number, number] {
  const x = p0[0] + (p1[0] - p0[0]) * t;
  const y = p0[1] + (p1[1] - p0[1]) * t;
  // Parabolic elevation: peak at t = 0.5 (4 * 0.5 * 0.5 = 1)
  const z = 4.0 * maxH * t * (1.0 - t);
  return [x, y, z];
}

// Cyan/azure at source (inbound/outbound origin) -> Orange/magenta at target
export function flowColor(_v: number, t: number): [number, number, number, number] {
  const r0 = 0.08, g0 = 0.65, b0 = 0.98; // Bright cyan/blue
  const r1 = 0.98, g1 = 0.25, b1 = 0.45; // Bright magenta/rose
  const r = r0 + (r1 - r0) * t;
  const g = g0 + (g1 - g0) * t;
  const b = b0 + (b1 - b0) * t;
  const a = 0.85;
  return [r, g, b, a];
}

export function decodeArcData(buffer: ArrayBuffer): ArcDataset {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'DARC') throw new Error(`Invalid magic: ${magic}`);

  const countyCount = view.getUint16(6, true);
  const flowCount = view.getUint32(8, true);
  const landRingCount = view.getUint16(12, true);
  const nameBytes = view.getUint32(14, true);

  let offset = 32;

  // Centroids: countyCount * 2 floats
  const centroids = new Float32Array(buffer.slice(offset, offset + countyCount * 2 * 4));
  offset += countyCount * 2 * 4;

  // Flows: flowCount * 8 bytes
  const flows: FlowRecord[] = new Array(flowCount);
  for (let i = 0; i < flowCount; i++) {
    const s = view.getUint16(offset, true);
    const t = view.getUint16(offset + 2, true);
    const v = view.getInt32(offset + 4, true);
    flows[i] = { s, t, v };
    offset += 8;
  }

  // Land rings
  const landRings: Float32Array[] = [];
  for (let r = 0; r < landRingCount; r++) {
    const ptCount = view.getUint32(offset, true);
    offset += 4;
    const ring = new Float32Array(buffer.slice(offset, offset + ptCount * 2 * 4));
    landRings.push(ring);
    offset += ptCount * 2 * 4;
  }

  // County names
  const rawNames = new Uint8Array(buffer, offset, nameBytes);
  const names = new TextDecoder('utf-8')
    .decode(rawNames)
    .split('\0')
    .filter((s) => s.length > 0);

  return {
    countyCount,
    flowCount,
    centroids,
    flows,
    landRings,
    names,
  };
}
