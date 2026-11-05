export interface TerritoryBounds { xmin: number; ymin: number; xmax: number; ymax: number }
export interface BuildingFeature { id: bigint; kind: string; rings: Float64Array[] }
export interface DecodedTerritory { bounds: TerritoryBounds; features: BuildingFeature[] }
export interface TerritoryView { centerX: number; centerY: number; pixelsPerProjectedMeter: number; zoom: number }

const MAGIC = 'BRG1';
const KIND_IDS = new Map([
  ['yes', 0], ['residential', 1], ['apartments', 1], ['house', 1], ['detached', 1], ['commercial', 2],
  ['retail', 3], ['industrial', 4], ['warehouse', 4], ['office', 5], ['school', 6], ['public', 6],
  ['hospital', 6], ['civic', 6], ['church', 6], ['university', 6],
]);
const ID_KINDS = ['yes', 'residential', 'commercial', 'retail', 'industrial', 'office', 'civic'] as const;

export function calibrationPxPerMm(referenceCssPixels: number): number {
  if (!Number.isFinite(referenceCssPixels)) throw new RangeError('Calibration width must be finite');
  if (referenceCssPixels <= 0) throw new RangeError('Calibration width must be positive');
  return referenceCssPixels / 85.6;
}

export function groundScale(cssPixelsPerMm: number, latitude: number): number {
  if (!Number.isFinite(cssPixelsPerMm) || cssPixelsPerMm <= 0) throw new RangeError('Calibration scale must be positive and finite');
  if (!Number.isFinite(latitude) || Math.abs(latitude) >= 85.05112878) throw new RangeError('Latitude is outside the Web Mercator domain');
  return cssPixelsPerMm * 1000 * Math.cos(latitude * Math.PI / 180);
}

export function screenPoint(x: number, y: number, view: TerritoryView, width: number, height: number): [number, number] {
  const scale = view.pixelsPerProjectedMeter * view.zoom;
  return [width / 2 + (x - view.centerX) * scale, height / 2 - (y - view.centerY) * scale];
}

export function zoomAt(view: TerritoryView, requestedZoom: number, x: number, y: number, width: number, height: number): TerritoryView {
  const zoom = Math.max(0.01, Math.min(250, requestedZoom));
  const oldScale = view.pixelsPerProjectedMeter * view.zoom, newScale = view.pixelsPerProjectedMeter * zoom;
  const dx = x - width / 2, dy = y - height / 2;
  const anchorX = view.centerX + dx / oldScale, anchorY = view.centerY - dy / oldScale;
  return { ...view, zoom, centerX: anchorX - dx / newScale, centerY: anchorY + dy / newScale };
}

export function boundsIntersect(a: TerritoryBounds, b: TerritoryBounds): boolean {
  return a.xmin <= b.xmax && a.xmax >= b.xmin && a.ymin <= b.ymax && a.ymax >= b.ymin;
}

function validateBounds(bounds: TerritoryBounds): void {
  const values = [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax];
  if (!values.every(Number.isFinite) || bounds.xmin >= bounds.xmax || bounds.ymin >= bounds.ymax) throw new RangeError('Invalid territory bounds');
}

export function encodeTerritory(features: BuildingFeature[], bounds: TerritoryBounds): ArrayBuffer {
  validateBounds(bounds);
  const size = 40 + features.reduce((total, feature) => {
    if (feature.id < -0x8000_0000_0000_0000n || feature.id > 0x7fff_ffff_ffff_ffffn) throw new RangeError('Invalid OSM id');
    if (!KIND_IDS.has(feature.kind)) throw new RangeError(`Unknown building class: ${feature.kind}`);
    if (feature.rings.length === 0 || feature.rings.length > 0xffff) throw new RangeError('Invalid ring count');
    return total + 11 + feature.rings.reduce((sum, ring) => {
      if (ring.length < 6 || ring.length % 2 !== 0) throw new RangeError('Invalid ring coordinates');
      for (let i = 0; i < ring.length; i += 2) {
        if (!Number.isFinite(ring[i]) || !Number.isFinite(ring[i + 1])) throw new RangeError('Non-finite ring coordinate');
      }
      return sum + 4 + ring.length * 4;
    }, 0);
  }, 0);
  const buffer = new ArrayBuffer(size), view = new DataView(buffer);
  for (let i = 0; i < MAGIC.length; i++) view.setUint8(i, MAGIC.charCodeAt(i));
  view.setUint32(4, features.length, true);
  [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax].forEach((value, i) => view.setFloat64(8 + i * 8, value, true));
  let offset = 40;
  for (const feature of features) {
    view.setBigInt64(offset, feature.id, true); offset += 8;
    view.setUint8(offset++, KIND_IDS.get(feature.kind)!); view.setUint16(offset, feature.rings.length, true); offset += 2;
    for (const ring of feature.rings) {
      view.setUint32(offset, ring.length / 2, true); offset += 4;
      for (let i = 0; i < ring.length; i += 2) {
        view.setFloat32(offset, ring[i]! - bounds.xmin, true); offset += 4;
        view.setFloat32(offset, ring[i + 1]! - bounds.ymin, true); offset += 4;
      }
    }
  }
  return buffer;
}

export function decodeTerritory(buffer: ArrayBuffer): DecodedTerritory {
  if (buffer.byteLength < 40) throw new Error('Truncated BRG1 header');
  const view = new DataView(buffer);
  if (Array.from({ length: 4 }, (_, i) => String.fromCharCode(view.getUint8(i))).join('') !== MAGIC) throw new Error('Invalid BRG1 magic');
  const count = view.getUint32(4, true);
  const bounds = { xmin: view.getFloat64(8, true), ymin: view.getFloat64(16, true), xmax: view.getFloat64(24, true), ymax: view.getFloat64(32, true) };
  validateBounds(bounds);
  const features: BuildingFeature[] = [];
  let offset = 40;
  for (let featureIndex = 0; featureIndex < count; featureIndex++) {
    if (offset + 11 > buffer.byteLength) throw new Error('Truncated BRG1 feature');
    const id = view.getBigInt64(offset, true); offset += 8;
    const kindId = view.getUint8(offset++), kind = ID_KINDS[kindId];
    if (!kind) throw new Error(`Invalid BRG1 class id ${kindId}`);
    const ringCount = view.getUint16(offset, true); offset += 2;
    if (ringCount === 0) throw new Error('Invalid BRG1 ring count');
    const rings: Float64Array[] = [];
    for (let ringIndex = 0; ringIndex < ringCount; ringIndex++) {
      if (offset + 4 > buffer.byteLength) throw new Error('Truncated BRG1 ring');
      const points = view.getUint32(offset, true); offset += 4;
      if (points < 3 || points > 1_000_000 || offset + points * 8 > buffer.byteLength) throw new Error('Invalid or truncated BRG1 coordinates');
      const ring = new Float64Array(points * 2);
      for (let point = 0; point < points; point++) {
        const x = view.getFloat32(offset, true) + bounds.xmin; offset += 4;
        const y = view.getFloat32(offset, true) + bounds.ymin; offset += 4;
        if (!Number.isFinite(x + y)) throw new Error('Non-finite BRG1 coordinate');
        ring[point * 2] = x; ring[point * 2 + 1] = y;
      }
      rings.push(ring);
    }
    features.push({ id, kind, rings });
  }
  if (offset !== buffer.byteLength) throw new Error('Unexpected trailing BRG1 bytes');
  return { bounds, features };
}
