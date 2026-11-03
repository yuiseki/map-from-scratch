// The baked tileset: tileset.json (the tree) and one binary file per node.
// A node file holds `count` points as interleaved uint16 x, y, z quantised
// over the node's box, then `count` RGB triples: 9 bytes a point, uploaded
// to the GPU as is (two buffers, no decoding on the CPU).
export type Vec3 = [number, number, number];

export interface TileNode {
  key: string;              // "z/x/y" of the GSJ tile the node was made from
  level: number;            // 0 for the roots
  min: Vec3; max: Vec3;     // bounds in metres (east, north, up) from the origin
  count: number;
  // Mean point spacing for inner nodes, 0 for leaves: the 3D Tiles
  // convention, so a leaf's attenuation falls back to the base resolution.
  geometricError: number;
  children: number[];       // indices into Tileset.nodes
  file: string;             // relative to tileset.json
}

export interface Tileset {
  origin: { lon: number; lat: number };
  roots: number[];
  nodes: TileNode[];
  attribution: string;
}

export const nodeBytes = (count: number) => count * 9;

export function encodeNode(xyz: Float32Array, rgb: Uint8Array, min: Vec3, max: Vec3): Uint8Array {
  const count = xyz.length / 3;
  const out = new Uint8Array(nodeBytes(count));
  const q = new Uint16Array(out.buffer, 0, count * 3);
  for (let i = 0; i < count * 3; i++) {
    const a = i % 3, extent = max[a] - min[a];
    q[i] = extent > 0 ? Math.max(0, Math.min(65535, Math.round((xyz[i] - min[a]) / extent * 65535))) : 0;
  }
  out.set(rgb.subarray(0, count * 3), count * 6);
  return out;
}

export function decodeNode(buffer: ArrayBuffer, count: number): { q: Uint16Array; rgb: Uint8Array } {
  if (buffer.byteLength < nodeBytes(count)) throw new Error(`node file is ${buffer.byteLength} bytes, expected ${nodeBytes(count)}`);
  return { q: new Uint16Array(buffer, 0, count * 3), rgb: new Uint8Array(buffer, count * 6, count * 3) };
}

// Aerial LiDAR samples a surface, so spacing comes from the footprint area.
export const surfaceSpacing = (min: Vec3, max: Vec3, count: number) =>
  Math.sqrt((max[0] - min[0]) * (max[1] - min[1]) / Math.max(1, count));
