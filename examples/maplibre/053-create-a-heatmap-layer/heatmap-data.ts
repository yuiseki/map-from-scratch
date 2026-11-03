export interface HeatmapData { count: number; points: Float32Array }

// The bake writes an eight-byte EQHM header followed by packed x/y/weight triples.
export function decodeHeatmapData(buffer: ArrayBuffer): HeatmapData {
  const count = new Uint32Array(buffer, 4, 1)[0];
  return { count, points: new Float32Array(buffer, 8, count * 3) };
}
