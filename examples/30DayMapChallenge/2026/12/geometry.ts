import { simplify } from '../../../../tools/geo.ts';
import type { Point } from '../../../../tools/geo.ts';

function openRing(points: Point[]): Point[] {
  if (points.length > 1 && points[0]![0] === points.at(-1)![0] && points[0]![1] === points.at(-1)![1]) points.pop();
  return points;
}

export function simplifyRing(
  ring: readonly Point[],
  tolerance: number,
  project: (point: Point) => Point,
): Point[] {
  const projected = ring.map(project);
  const reduced = openRing(simplify(projected, tolerance));
  return reduced.length >= 3 ? reduced : openRing(projected);
}

export interface CountryGeometryInput {
  iso3: string;
  name: string;
  label: Point;
  rings: Point[][];
}
export interface PackedCountry {
  iso3: string;
  name: string;
  label: Point;
  rings: { offset: number; count: number }[];
}
export interface DecodedCountry extends Omit<PackedCountry, 'rings'> { rings: Point[][] }
const GEOMETRY_HEADER = 8;
const QUANTIZATION = 65_535;

export function encodeCountryGeometry(countries: readonly CountryGeometryInput[]) {
  const metadata: PackedCountry[] = [], coordinates: number[] = [];
  const seen = new Set<string>();
  for (const country of countries) {
    if (!/^[A-Z]{3}$/.test(country.iso3) || seen.has(country.iso3)) throw new Error(`Invalid or duplicate country ISO3: ${country.iso3}`);
    seen.add(country.iso3);
    if (!country.name || country.label.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Country label must use normalized coordinates');
    const rings: { offset: number; count: number }[] = [];
    for (const ring of country.rings) {
      if (ring.length < 3) throw new Error(`Country ${country.iso3} has a ring with fewer than three points`);
      if (ring.some((point) => point.some((value) => !Number.isFinite(value) || value < 0 || value > 1))) throw new Error('Country ring has a non-normalized coordinate');
      rings.push({ offset: coordinates.length / 2, count: ring.length });
      for (const [x, y] of ring) coordinates.push(Math.round(x * QUANTIZATION), Math.round(y * QUANTIZATION));
    }
    metadata.push({ iso3: country.iso3, name: country.name, label: [...country.label], rings });
  }
  const pointCount = coordinates.length / 2, buffer = new ArrayBuffer(GEOMETRY_HEADER + coordinates.length * 2), view = new DataView(buffer);
  for (let i = 0; i < 4; i++) view.setUint8(i, 'EQG1'.charCodeAt(i));
  view.setUint32(4, pointCount, true);
  for (let i = 0; i < coordinates.length; i++) view.setUint16(GEOMETRY_HEADER + i * 2, coordinates[i]!, true);
  return { metadata, buffer, pointCount };
}

export function decodeCountryGeometry(buffer: ArrayBuffer, metadata: readonly PackedCountry[]): DecodedCountry[] {
  if (buffer.byteLength < GEOMETRY_HEADER) throw new Error('Truncated EQG1 geometry header');
  const view = new DataView(buffer), magic = String.fromCharCode(...new Uint8Array(buffer, 0, 4)), pointCount = view.getUint32(4, true);
  if (magic !== 'EQG1' || GEOMETRY_HEADER + pointCount * 4 !== buffer.byteLength) throw new Error('Invalid EQG1 geometry data');
  const seen = new Set<string>();
  return metadata.map((country) => {
    if (!/^[A-Z]{3}$/.test(country.iso3) || seen.has(country.iso3)) throw new Error(`Invalid or duplicate country ISO3: ${country.iso3}`);
    seen.add(country.iso3);
    if (!country.name || country.label.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new Error('Country label must use normalized coordinates');
    const rings = country.rings.map(({ offset, count }) => {
      if (!Number.isInteger(offset) || !Number.isInteger(count) || count < 3 || offset < 0 || offset + count > pointCount) throw new Error(`Invalid country ring offset for ${country.iso3}`);
      return Array.from({ length: count }, (_, index) => {
        const position = GEOMETRY_HEADER + (offset + index) * 4;
        return [view.getUint16(position, true) / QUANTIZATION, view.getUint16(position + 2, true) / QUANTIZATION] as Point;
      });
    });
    return { iso3: country.iso3, name: country.name, label: [...country.label] as Point, rings };
  });
}
