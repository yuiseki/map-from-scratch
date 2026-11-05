import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { encodeTerritory, type BuildingFeature, type TerritoryBounds } from './territory.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-14';
// A 500 m EPSG:3857 square around Shibuya Crossing; inverse bounds are recorded in spec.yaml.
const bounds: TerritoryBounds = { xmin: 15_551_260.975, ymin: 4_253_619.680, xmax: 15_551_760.975, ymax: 4_254_119.680 };
const sourceTable = source('osm-tokyo23-polygons').replaceAll("'", "''");
const sql = `LOAD spatial;
SELECT to_json(struct_pack(id := osm_id, kind := building, wkb := hex(ST_AsWKB(way))))
FROM read_parquet('${sourceTable}')
WHERE building IS NOT NULL
  AND bbox.xmin <= ${bounds.xmax} AND bbox.xmax >= ${bounds.xmin}
  AND bbox.ymin <= ${bounds.ymax} AND bbox.ymax >= ${bounds.ymin}
ORDER BY osm_id`;
const rows = execFileSync('duckdb', ['-noheader', '-list', '-separator', '\t', '-c', sql], { encoding: 'utf8', maxBuffer: 64 << 20 })
  .trimEnd().split('\n').filter(Boolean);

function polygonRings(hex: string): Float64Array[] {
  const raw = Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
  const view = new DataView(raw.buffer);
  let offset = 0;
  function uint32(little: boolean): number { const value = view.getUint32(offset, little); offset += 4; return value; }
  function polygon(): Float64Array[] {
    if (offset + 5 > raw.byteLength) throw new Error('Truncated OSM WKB');
    const endian = raw[offset++]!;
    if (endian !== 0 && endian !== 1) throw new Error('Invalid WKB byte order');
    const little = endian === 1, type = uint32(little);
    if ((type & 0xffff) !== 3) throw new Error(`Expected polygon WKB, got type ${type}`);
    const count = uint32(little);
    if (count === 0 || count > 100_000) throw new Error(`Invalid polygon ring count ${count}`);
    const rings: Float64Array[] = [];
    for (let ringIndex = 0; ringIndex < count; ringIndex++) {
      const points = uint32(little);
      if (points < 4 || points > 1_000_000 || offset + points * 16 > raw.byteLength) throw new Error(`Invalid or truncated WKB ring with ${points} points`);
      const coords = new Float64Array(points * 2);
      for (let point = 0; point < points; point++) {
        const x = view.getFloat64(offset, little); offset += 8;
        const y = view.getFloat64(offset, little); offset += 8;
        coords[point * 2] = x; coords[point * 2 + 1] = y;
      }
      rings.push(coords);
    }
    return rings;
  }
  if (raw.byteLength < 5) throw new Error('Empty OSM WKB');
  const endian = raw[offset++]!;
  if (endian !== 1) throw new Error('Expected little-endian WKB');
  const type = uint32(true);
  offset = 0;
  let rings: Float64Array[];
  if ((type & 0xffff) === 3) rings = polygon();
  else if ((type & 0xffff) === 6) {
    const little = raw[offset++] === 1;
    if (!little || uint32(little) % 1000 !== 6) throw new Error('Invalid multipolygon WKB');
    const count = uint32(little);
    if (count === 0 || count > 100_000) throw new Error(`Invalid polygon count ${count}`);
    rings = [];
    for (let part = 0; part < count; part++) rings.push(...polygon());
  } else throw new Error(`Unsupported building WKB type ${type}`);
  if (offset !== raw.byteLength) throw new Error('Unexpected bytes after WKB geometry');
  return rings;
}

const classBySource: Record<string, string> = {
  yes: 'yes', residential: 'residential', apartments: 'apartments', commercial: 'commercial', retail: 'retail',
  office: 'office', industrial: 'industrial', warehouse: 'industrial', roof: 'yes', train_station: 'civic',
  college: 'civic', bridge: 'yes',
};
const typeCounts: Record<string, number> = {};
const features: BuildingFeature[] = [];
for (const line of rows) {
  const row = JSON.parse(line) as { id: string | number; kind: string; wkb: string };
  const id = BigInt(row.id), kind = row.kind;
  if (!kind || !row.wkb || id === 0n) throw new Error(`Malformed OSM polygon row: ${line.slice(0, 160)}`);
  typeCounts[kind] = (typeCounts[kind] ?? 0) + 1;
  features.push({ id, kind: classBySource[kind] ?? 'yes', rings: polygonRings(row.wkb) });
}
if (features.length < 100 || features.length > 10_000) throw new Error(`Unexpected Shibuya building count ${features.length}`);
const encoded = encodeTerritory(features, bounds);
const stats = {
  source: 'OpenStreetMap Tokyo 23 wards frozen extract 2026-08-31, osm2pgsql polygon table',
  sourceUrl: 'https://huggingface.co/datasets/yuiseki/osm-tokyo23-src-2026-08',
  license: 'ODbL 1.0',
  coordinateReferenceSystem: 'EPSG:3857 (metres)',
  queryBoundsEpsg3857: bounds,
  queryBoundsWgs84: { west: 139.6993542117395, south: 35.6576752828918, east: 139.7038457881601, north: 35.66132466989101 },
  centerWgs84: { lon: 139.7016, lat: 35.6595 },
  physicalFocus: {
    osmRelationId: 904652357,
    epsg3857: { x: 15_551_500.93321805, y: 4_253_738.528960587 },
    wgs84: { lon: 139.70150979308778, lat: 35.658542749704964 },
    method: 'ST_PointOnSurface of this frozen OSM polygon; chosen to put the exact-scale detail window inside a mapped footprint.',
  },
  sourcePolygonRowsIntersecting: 337,
  sourceBuildingRows: features.length,
  uniqueOsmIds: new Set(features.map((feature) => feature.id.toString())).size,
  sourceBuildingTagCounts: typeCounts,
  vertexCount: features.reduce((sum, feature) => sum + feature.rings.reduce((n, ring) => n + ring.length / 2, 0), 0),
  ringCount: features.reduce((sum, feature) => sum + feature.rings.length, 0),
  outputBytes: encoded.byteLength,
  geometry: 'Full source polygon rings retained; the renderer clips to this rectangular query window.',
};
if (stats.uniqueOsmIds !== features.length) throw new Error(`Duplicate building ids: ${stats.uniqueOsmIds} / ${features.length}`);
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/buildings.bin`, new Uint8Array(encoded));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`OSM buildings: ${features.length}; ${stats.ringCount} rings / ${stats.vertexCount} vertices; ${encoded.byteLength} B`);
