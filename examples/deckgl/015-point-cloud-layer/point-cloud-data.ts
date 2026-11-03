export interface PointCloudData {
  count: number;
  lo: number[];
  span: number[];
  points: Uint32Array;
}

export function parsePointCloud(data: ArrayBuffer): PointCloudData {
  if (data.byteLength < 32 || String.fromCharCode(...new Uint8Array(data, 0, 4)) !== 'PC01') {
    throw new Error('invalid point-cloud header');
  }
  const view = new DataView(data);
  const count = view.getUint32(4, true);
  if (data.byteLength !== 32 + count * 4) throw new Error('invalid point-cloud length');
  const mins = [0, 1, 2].map((i) => view.getFloat32(8 + i * 4, true));
  const maxs = [0, 1, 2].map((i) => view.getFloat32(20 + i * 4, true));
  return {
    count,
    lo: mins.map((value, i) => value - (value + maxs[i]) / 2),
    span: maxs.map((value, i) => value - mins[i]),
    points: new Uint32Array(data, 32, count),
  };
}
