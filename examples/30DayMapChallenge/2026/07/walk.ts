export type Point = [number, number];
export interface RoadWay {
  highway: string;
  coordinates: Point[];
  access?: string | null;
  foot?: string | null;
}
export interface GraphEdge { a: number; b: number; length: number; highway: string }
export interface WalkGraph { nodes: Point[]; edges: GraphEdge[]; adjacency: number[][] }
export interface WalkSegment { from: Point; to: Point; startSeconds: number; endSeconds: number; highway: string; reachable: boolean }
export interface Walkshed { nodeCount: number; reachedNodeCount: number; originNode: number; origin: Point; bounds: { minX: number; minY: number; maxX: number; maxY: number }; segments: WalkSegment[] }
export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

const WALKABLE = new Set(['footway', 'path', 'steps', 'pedestrian', 'residential', 'living_street', 'service', 'unclassified', 'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'trunk', 'trunk_link', 'cycleway', 'track', 'bridleway']);
const CLOSED = new Set(['motorway', 'motorway_link', 'raceway', 'construction', 'proposed', 'busway', 'bus_stop', 'platform', 'elevator', 'corridor', 'rest_area']);
const PERMITTED = new Set(['yes', 'designated', 'permissive', 'official']);
const FORBIDDEN = new Set(['no', 'private']);

export function isWalkable(way: RoadWay): boolean {
  const foot = way.foot?.toLowerCase() ?? '';
  const access = way.access?.toLowerCase() ?? '';
  if (FORBIDDEN.has(foot)) return false;
  const explicitFoot = PERMITTED.has(foot);
  if (CLOSED.has(way.highway) && !explicitFoot) return false;
  if (FORBIDDEN.has(access) && !explicitFoot) return false;
  return explicitFoot || WALKABLE.has(way.highway);
}

function key([x, y]: Point): string { return `${Math.round(x * 100)},${Math.round(y * 100)}`; }

export function buildWalkGraph(ways: RoadWay[]): WalkGraph {
  const nodes: Point[] = [], edges: GraphEdge[] = [], byKey = new Map<string, number>();
  const adjacency: number[][] = [];
  const nodeId = (p: Point): number => {
    const k = key(p), old = byKey.get(k);
    if (old !== undefined) return old;
    const id = nodes.length; nodes.push(p); adjacency.push([]); byKey.set(k, id); return id;
  };
  for (const way of ways) {
    if (!isWalkable(way) || way.coordinates.length < 2) continue;
    let previous = -1;
    for (const point of way.coordinates) {
      if (!Number.isFinite(point[0] + point[1])) throw new Error('Road coordinate must be finite');
      const current = nodeId(point);
      if (previous >= 0 && previous !== current) {
        const a = nodes[previous]!, b = nodes[current]!;
        const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (length > 0) { const edge = edges.length; edges.push({ a: previous, b: current, length, highway: way.highway }); adjacency[previous]!.push(edge); adjacency[current]!.push(edge); }
      }
      previous = current;
    }
  }
  return { nodes, edges, adjacency };
}

function clipSegment(a: Point, b: Point, bounds: Bounds): [Point, Point] | null {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let low = 0, high = 1;
  for (const [p, q] of [[-dx, a[0] - bounds.minX], [dx, bounds.maxX - a[0]], [-dy, a[1] - bounds.minY], [dy, bounds.maxY - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const ratio = q / p;
    if (p < 0) low = Math.max(low, ratio); else high = Math.min(high, ratio);
    if (low > high) return null;
  }
  return [[a[0] + low * dx, a[1] + low * dy], [a[0] + high * dx, a[1] + high * dy]];
}

export function clipRoadWays(ways: RoadWay[], bounds: Bounds): RoadWay[] {
  const clipped: RoadWay[] = [];
  for (const way of ways) for (let i = 0; i + 1 < way.coordinates.length; i++) {
    const line = clipSegment(way.coordinates[i]!, way.coordinates[i + 1]!, bounds);
    if (line && key(line[0]) !== key(line[1])) clipped.push({ ...way, coordinates: line });
  }
  return clipped;
}

class MinHeap {
  #items: [number, number][] = [];
  get size() { return this.#items.length; }
  push(item: [number, number]) {
    const a = this.#items; a.push(item); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p]![0] <= item[0]) break; a[i] = a[p]!; i = p; }
    a[i] = item;
  }
  pop(): [number, number] | undefined {
    const a = this.#items, first = a[0]; if (!first) return undefined;
    const last = a.pop()!; if (a.length) {
      let i = 0;
      while (true) { let c = i * 2 + 1; if (c >= a.length) break; if (c + 1 < a.length && a[c + 1]![0] < a[c]![0]) c++;
        if (a[c]![0] >= last[0]) break; a[i] = a[c]!; i = c; }
      a[i] = last;
    }
    return first;
  }
}

export function calculateWalkshed(graph: WalkGraph, origin: Point, minutes: number, speedMps: number, metersPerProjectedMeter = 1): Walkshed {
  if (!Number.isFinite(minutes) || minutes <= 0 || !Number.isFinite(speedMps) || speedMps <= 0 || metersPerProjectedMeter <= 0) throw new Error('Walk time, speed, and projection scale must be positive');
  if (!graph.nodes.length) throw new Error('Walk graph has no eligible road nodes');
  let originNode = 0, snapDistance = Infinity;
  for (let i = 0; i < graph.nodes.length; i++) {
    const d = Math.hypot(graph.nodes[i]![0] - origin[0], graph.nodes[i]![1] - origin[1]) * metersPerProjectedMeter;
    if (d < snapDistance) { originNode = i; snapDistance = d; }
  }
  const limit = minutes * 60, distances = new Float64Array(graph.nodes.length); distances.fill(Infinity);
  distances[originNode] = snapDistance / speedMps;
  const heap = new MinHeap(); heap.push([distances[originNode]!, originNode]);
  while (heap.size) {
    const [time, node] = heap.pop()!;
    if (time !== distances[node] || time > limit) continue;
    for (const edgeId of graph.adjacency[node]!) {
      const edge = graph.edges[edgeId]!, next = edge.a === node ? edge.b : edge.a;
      const candidate = time + edge.length * metersPerProjectedMeter / speedMps;
      if (candidate < distances[next]! && candidate <= limit) { distances[next] = candidate; heap.push([candidate, next]); }
    }
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, reachedNodeCount = 0;
  for (let i = 0; i < graph.nodes.length; i++) {
    const [x, y] = graph.nodes[i]!; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    if (distances[i]! <= limit) reachedNodeCount++;
  }
  const segments: WalkSegment[] = [];
  for (const edge of graph.edges) {
    const da = distances[edge.a]!, db = distances[edge.b]!, edgeSeconds = edge.length * metersPerProjectedMeter / speedMps;
    if (Math.min(da, db) > limit) {
      segments.push({ from: graph.nodes[edge.a]!, to: graph.nodes[edge.b]!, startSeconds: Infinity, endSeconds: Infinity, highway: edge.highway, reachable: false });
      continue;
    }
    const fromA = da <= db, startTime = Math.min(da, db), fraction = Math.min(1, Math.max(0, (limit - startTime) / edgeSeconds));
    const start = graph.nodes[fromA ? edge.a : edge.b]!, end = graph.nodes[fromA ? edge.b : edge.a]!;
    if (fraction <= 0) {
      segments.push({ from: start, to: end, startSeconds: Infinity, endSeconds: Infinity, highway: edge.highway, reachable: false });
      continue;
    }
    segments.push({
      from: start,
      to: [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction],
      startSeconds: startTime, endSeconds: Math.min(limit, startTime + edgeSeconds * fraction), highway: edge.highway, reachable: true,
    });
    if (fraction < 1) segments.push({
      from: [start[0] + (end[0] - start[0]) * fraction, start[1] + (end[1] - start[1]) * fraction],
      to: end, startSeconds: Infinity, endSeconds: Infinity, highway: edge.highway, reachable: false,
    });
  }
  return { nodeCount: graph.nodes.length, reachedNodeCount, originNode, origin: graph.nodes[originNode]!, bounds: { minX, minY, maxX, maxY }, segments };
}

const CLASSES = new Map([['footway', 0], ['path', 0], ['pedestrian', 0], ['steps', 1], ['service', 2], ['residential', 2], ['living_street', 2], ['unclassified', 2], ['tertiary', 3], ['tertiary_link', 3], ['secondary', 3], ['secondary_link', 3], ['primary', 4], ['primary_link', 4], ['trunk', 4], ['trunk_link', 4], ['cycleway', 0], ['track', 0], ['bridleway', 0]]);
export const WALK_SEGMENT_STRIDE = 12;

export function encodeWalkSegments(segments: WalkSegment[], bounds: Bounds, maxSeconds = 600): ArrayBuffer {
  if (!(bounds.maxX > bounds.minX) || !(bounds.maxY > bounds.minY) || segments.length > 0xffffffff || maxSeconds <= 0) throw new Error('Invalid walkshed encoding bounds');
  const buffer = new ArrayBuffer(44 + segments.length * WALK_SEGMENT_STRIDE), view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, 'W10M'.charCodeAt(i));
  view.setUint32(4, segments.length, true);
  view.setFloat64(8, bounds.minX, true); view.setFloat64(16, bounds.minY, true);
  view.setFloat64(24, bounds.maxX, true); view.setFloat64(32, bounds.maxY, true);
  view.setFloat32(40, maxSeconds, true);
  let offset = 44;
  for (const segment of segments) {
    for (const [point, base] of [[segment.from, 0], [segment.to, 4]] as const) {
      view.setUint16(offset + base, Math.max(0, Math.min(65535, Math.round((point[0] - bounds.minX) / (bounds.maxX - bounds.minX) * 65535))), true);
      view.setUint16(offset + base + 2, Math.max(0, Math.min(65535, Math.round((bounds.maxY - point[1]) / (bounds.maxY - bounds.minY) * 65535))), true);
    }
    view.setUint8(offset + 8, segment.reachable ? Math.max(0, Math.min(254, Math.round(segment.startSeconds / maxSeconds * 254))) : 255);
    view.setUint8(offset + 9, segment.reachable ? Math.max(0, Math.min(254, Math.round(segment.endSeconds / maxSeconds * 254))) : 255);
    view.setUint8(offset + 10, CLASSES.get(segment.highway) ?? 0);
    view.setUint8(offset + 11, 0); offset += WALK_SEGMENT_STRIDE;
  }
  return buffer;
}
