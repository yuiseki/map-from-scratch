export type Category = 'road' | 'railway' | 'building' | 'water' | 'green' | 'public-place';
export type TableName = 'planet_osm_point' | 'planet_osm_roads' | 'planet_osm_line' | 'planet_osm_polygon';
export type XY = [number, number];
export interface OSMFeature {
  table: TableName;
  id: bigint;
  category: Category;
  geometry: { type: 'point' | 'line' | 'polygon'; parts: XY[][]; polygonRingEnds?: number[] };
  tags: Record<string, string>;
}
export interface Extent { xmin: number; ymin: number; xmax: number; ymax: number }
interface SpatialNode { bounds: Extent; left?: SpatialNode; right?: SpatialNode; items?: number[] }
export interface SpatialIndex { root: SpatialNode | null; bounds: Extent[] }
export interface View {
  scale: number; width: number; height: number; offsetX: number; offsetY: number;
  xmin: number; ymax: number;
  toMap(point: XY): XY;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const tables: TableName[] = ['planet_osm_point', 'planet_osm_roads', 'planet_osm_line', 'planet_osm_polygon'];
const categories: Category[] = ['road', 'railway', 'building', 'water', 'green', 'public-place'];
const geometryTypes = ['point', 'line', 'polygon'] as const;

function unionBounds(items: number[], bounds: Extent[]): Extent {
  const result = { xmin: Infinity, ymin: Infinity, xmax: -Infinity, ymax: -Infinity };
  for (const index of items) {
    const item = bounds[index]!;
    result.xmin = Math.min(result.xmin, item.xmin); result.ymin = Math.min(result.ymin, item.ymin);
    result.xmax = Math.max(result.xmax, item.xmax); result.ymax = Math.max(result.ymax, item.ymax);
  }
  return result;
}

/** Build a static median-split bounds tree; original item indices remain stable. */
export function buildSpatialIndex(bounds: Extent[], leafSize = 16): SpatialIndex {
  if (!Number.isInteger(leafSize) || leafSize < 1) throw new Error('invalid spatial index leaf size');
  for (const item of bounds) if (![item.xmin, item.ymin, item.xmax, item.ymax].every(Number.isFinite)
      || item.xmin > item.xmax || item.ymin > item.ymax) throw new Error('invalid spatial index bounds');
  const build = (indices: number[]): SpatialNode => {
    const box = unionBounds(indices, bounds);
    if (indices.length <= leafSize) return { bounds: box, items: indices };
    const xAxis = box.xmax - box.xmin >= box.ymax - box.ymin;
    indices.sort((a, b) => xAxis
      ? (bounds[a]!.xmin + bounds[a]!.xmax) - (bounds[b]!.xmin + bounds[b]!.xmax)
      : (bounds[a]!.ymin + bounds[a]!.ymax) - (bounds[b]!.ymin + bounds[b]!.ymax));
    const middle = indices.length >>> 1;
    return { bounds: box, left: build(indices.slice(0, middle)), right: build(indices.slice(middle)) };
  };
  return { root: bounds.length ? build(bounds.map((_, index) => index)) : null, bounds };
}

/** Return every intersecting item once, in original source order. */
export function querySpatialIndex(index: SpatialIndex, extent: Extent): number[] {
  if (![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)
      || extent.xmin > extent.xmax || extent.ymin > extent.ymax) throw new Error('invalid spatial query extent');
  const result: number[] = [], stack = index.root ? [index.root] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.bounds.xmin > extent.xmax || node.bounds.xmax < extent.xmin
        || node.bounds.ymin > extent.ymax || node.bounds.ymax < extent.ymin) continue;
    if (node.items) {
      for (const item of node.items) {
        const bounds = index.bounds[item]!;
        if (!(bounds.xmin > extent.xmax || bounds.xmax < extent.xmin || bounds.ymin > extent.ymax || bounds.ymax < extent.ymin)) result.push(item);
      }
    } else { if (node.right) stack.push(node.right); if (node.left) stack.push(node.left); }
  }
  result.sort((a, b) => a - b);
  return result;
}

export function fitExtent(extent: Extent, width: number, height: number, padding = 24): View {
  if (![extent.xmin, extent.ymin, extent.xmax, extent.ymax].every(Number.isFinite)
      || extent.xmin >= extent.xmax || extent.ymin >= extent.ymax) throw new Error('invalid extent');
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0
      || !Number.isFinite(padding) || padding < 0 || width <= padding * 2 || height <= padding * 2) throw new Error('invalid viewport');
  const scale = Math.min((width - padding * 2) / (extent.xmax - extent.xmin), (height - padding * 2) / (extent.ymax - extent.ymin));
  const offsetX = (width - (extent.xmax - extent.xmin) * scale) / 2;
  const offsetY = (height - (extent.ymax - extent.ymin) * scale) / 2;
  return {
    scale, width, height, offsetX, offsetY, xmin: extent.xmin, ymax: extent.ymax,
    toMap([x, y]) { return [extent.xmin + (x - offsetX) / scale, extent.ymax - (y - offsetY) / scale]; },
  };
}

export function project3857([x, y]: XY, view: View): XY {
  return [view.offsetX + (x - view.xmin) * view.scale, view.offsetY + (view.ymax - y) * view.scale];
}

export function clipSegment(a: XY, b: XY, extent: Extent): [XY, XY] | null {
  // Liang–Barsky clipping, with shared boundary points preserved at both ends.
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy], q = [a[0] - extent.xmin, extent.xmax - a[0], a[1] - extent.ymin, extent.ymax - a[1]];
  let lo = 0, hi = 1;
  for (let i = 0; i < 4; i++) {
    const pi = p[i]!, qi = q[i]!;
    if (pi === 0) { if (qi < 0) return null; continue; }
    const r = qi / pi;
    if (pi < 0) { if (r > hi) return null; lo = Math.max(lo, r); }
    else { if (r < lo) return null; hi = Math.min(hi, r); }
  }
  return [[a[0] + lo * dx, a[1] + lo * dy], [a[0] + hi * dx, a[1] + hi * dy]];
}

export function classifyOsmTags(table: TableName, tags: Record<string, string>): Category | null {
  if (table === 'planet_osm_polygon') {
    if (tags.building) return 'building';
    if (tags.water || tags.natural === 'water' || tags.landuse === 'reservoir') return 'water';
    if (tags.leisure || ['grass', 'forest', 'recreation_ground'].includes(tags.landuse ?? '')
        || ['wood', 'grassland', 'scrub'].includes(tags.natural ?? '')) return 'green';
  }
  if (table === 'planet_osm_roads' || table === 'planet_osm_line') {
    if (tags.railway && ['rail', 'subway', 'light_rail', 'tram', 'narrow_gauge', 'monorail'].includes(tags.railway)) return 'railway';
    if (tags.highway) return 'road';
    if (table === 'planet_osm_line' && tags.waterway && ['river', 'canal', 'stream', 'drain', 'ditch'].includes(tags.waterway)) return 'water';
  }
  if (table === 'planet_osm_point' && (tags.amenity || tags.shop || tags.tourism || ['station', 'halt', 'tram_stop'].includes(tags.railway ?? ''))) return 'public-place';
  return null;
}

export function encodeOsmFeatures(features: OSMFeature[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([79, 83, 77, 49, features.length & 255, (features.length >>> 8) & 255, (features.length >>> 16) & 255, (features.length >>> 24) & 255])];
  const put = (length: number, write: (view: DataView) => void) => { const bytes = new Uint8Array(length); write(new DataView(bytes.buffer)); chunks.push(bytes); };
  const putText = (value: string) => { const bytes = encoder.encode(value); if (bytes.length > 65535) throw new Error('tag payload too large'); put(2, (view) => view.setUint16(0, bytes.length, true)); chunks.push(bytes); };
  for (const feature of features) {
    const table = tables.indexOf(feature.table), category = categories.indexOf(feature.category), type = geometryTypes.indexOf(feature.geometry.type);
    if (table < 0 || category < 0 || type < 0 || typeof feature.id !== 'bigint') throw new Error('invalid OSM feature identity');
    if (feature.geometry.parts.length > 65535) throw new Error('too many geometry parts');
    for (const part of feature.geometry.parts) {
      if (part.length > 1_000_000 || part.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y))) throw new Error('invalid OSM coordinates');
    }
    if (Object.entries(feature.tags).some(([key, value]) => typeof key !== 'string' || typeof value !== 'string')) throw new Error('invalid OSM tags');
    put(12, (view) => { view.setUint8(0, table); view.setBigInt64(1, BigInt(feature.id), true); view.setUint8(9, category); view.setUint8(10, type); view.setUint8(11, 0); });
    putText(JSON.stringify(feature.tags));
    put(2, (view) => view.setUint16(0, feature.geometry.parts.length, true));
    for (const part of feature.geometry.parts) {
      if (part.length > 1_000_000) throw new Error('geometry part too large');
      put(4, (view) => view.setUint32(0, part.length, true));
      put(part.length * 16, (view) => part.forEach(([x, y], i) => { view.setFloat64(i * 16, x, true); view.setFloat64(i * 16 + 8, y, true); }));
    }
    if (type === 2) {
      const ends = feature.geometry.polygonRingEnds ?? [feature.geometry.parts.length];
      if (!ends.length || ends.length > 65535 || ends.at(-1) !== feature.geometry.parts.length
          || ends.some((end, i) => !Number.isInteger(end) || end <= (i ? ends[i - 1]! : 0))) throw new Error('invalid polygon ring groups');
      put(2 + ends.length * 2, (view) => { view.setUint16(0, ends.length, true); ends.forEach((end, i) => view.setUint16(2 + i * 2, end, true)); });
    }
  }
  const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}

export function decodeOsmFeatures(bytes: Uint8Array): OSMFeature[] {
  if (bytes.length < 8 || bytes[0] !== 79 || bytes[1] !== 83 || bytes[2] !== 77 || bytes[3] !== 49) throw new Error('invalid OSM feature header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(4, true);
  if (count > 2_000_000) throw new Error('invalid OSM feature count');
  let offset = 8;
  const need = (length: number) => { if (!Number.isSafeInteger(length) || length < 0 || offset + length > bytes.length) throw new Error('truncated OSM feature data'); };
  const features: OSMFeature[] = [];
  for (let i = 0; i < count; i++) {
    need(12);
    const table = tables[view.getUint8(offset)]!, id = view.getBigInt64(offset + 1, true);
    const category = categories[view.getUint8(offset + 9)]!, type = geometryTypes[view.getUint8(offset + 10)]!;
    if (!table || !category || !type) throw new Error('invalid OSM feature identity');
    offset += 12;
    need(2); const tagLength = view.getUint16(offset, true); offset += 2; need(tagLength);
    const tagsValue: unknown = JSON.parse(decoder.decode(bytes.subarray(offset, offset + tagLength))); offset += tagLength;
    if (!tagsValue || typeof tagsValue !== 'object' || Array.isArray(tagsValue)) throw new Error('invalid OSM tags');
    need(2); const partCount = view.getUint16(offset, true); offset += 2;
    const parts: XY[][] = [];
    for (let p = 0; p < partCount; p++) {
      need(4); const points = view.getUint32(offset, true); offset += 4; need(points * 16);
      const part: XY[] = [];
      for (let j = 0; j < points; j++) part.push([view.getFloat64(offset + j * 16, true), view.getFloat64(offset + j * 16 + 8, true)]);
      offset += points * 16; parts.push(part);
    }
    let polygonRingEnds: number[] | undefined;
    if (type === 'polygon') {
      need(2); const groupCount = view.getUint16(offset, true); offset += 2; need(groupCount * 2);
      polygonRingEnds = [];
      for (let group = 0; group < groupCount; group++) polygonRingEnds.push(view.getUint16(offset + group * 2, true));
      offset += groupCount * 2;
      if (!groupCount || polygonRingEnds.at(-1) !== partCount || polygonRingEnds.some((end, index) => end <= (index ? polygonRingEnds![index - 1]! : 0))) throw new Error('invalid polygon ring groups');
    }
    features.push({ table, id, category, geometry: { type, parts, ...(polygonRingEnds ? { polygonRingEnds } : {}) }, tags: tagsValue as Record<string, string> });
  }
  if (offset !== bytes.length) throw new Error('unexpected trailing OSM feature bytes');
  return features;
}

function insideRing(point: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!, [xj, yj] = ring[j]!;
    if ((yi > point[1]) !== (yj > point[1]) && point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function distanceToSegment(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], denom = dx * dx + dy * dy;
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denom));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function hitTest(features: OSMFeature[], point: XY, tolerance: number): OSMFeature | null {
  for (let i = features.length - 1; i >= 0; i--) {
    const feature = features[i]!;
    if (feature.geometry.type === 'point') {
      if (feature.geometry.parts.some((part) => part[0] && Math.hypot(point[0] - part[0][0], point[1] - part[0][1]) <= tolerance)) return feature;
    } else if (feature.geometry.type === 'line') {
      if (feature.geometry.parts.some((line) => line.slice(1).some((b, j) => distanceToSegment(point, line[j]!, b) <= tolerance))) return feature;
    } else {
      const ends = feature.geometry.polygonRingEnds ?? [feature.geometry.parts.length];
      let start = 0;
      for (const end of ends) {
        const rings = feature.geometry.parts.slice(start, end); start = end;
        if (rings.length && insideRing(point, rings[0]!) && !rings.slice(1).some((hole) => insideRing(point, hole))) return feature;
      }
    }
  }
  return null;
}
