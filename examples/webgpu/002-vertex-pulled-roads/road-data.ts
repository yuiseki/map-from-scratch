export interface RoadData {
  roadCount: number;
  nodeCount: number;
  segmentCount: number;
  nodes: Uint32Array;
}

export function parseRoadData(buffer: ArrayBuffer): RoadData {
  if (buffer.byteLength < 32) throw new Error('truncated road data header');
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'VPRD') throw new Error(`Invalid magic: ${magic}`);
  const roadCount = view.getUint32(6, true), nodeCount = view.getUint32(10, true), segmentCount = view.getUint32(14, true);
  if (buffer.byteLength !== 32 + nodeCount * 8) throw new Error('truncated road nodes');
  return { roadCount, nodeCount, segmentCount, nodes: new Uint32Array(buffer, 32, nodeCount * 2) };
}
