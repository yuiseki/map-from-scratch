import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { encodeFacilities, encodeOutline, type Bounds, type Facility, type Position } from './clusters.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-04';
const POINTS = source('osm-tokyo23-points');
const BOUNDARY = source('osm-tokyo23-boundary');
const EARTH_RADIUS = 6_378_137;
interface GeoJSONBoundary { geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }
function mercator([lon, lat]: Position): Position {
  const phi = Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180;
  return [EARTH_RADIUS * lon * Math.PI / 180, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))];
}
function boundaryRings(boundary: GeoJSONBoundary): Position[][] {
  const polygons = boundary.geometry.type === 'Polygon'
    ? [boundary.geometry.coordinates as number[][][]]
    : boundary.geometry.coordinates as number[][][][];
  return polygons.flatMap((polygon) => polygon.map((ring) => ring.map((p) => mercator([p[0]!, p[1]!]))));
}

const rings = boundaryRings(JSON.parse(readFileSync(BOUNDARY, 'utf8')) as GeoJSONBoundary);
const boundaryPoints = rings.flat();
if (rings.length < 1 || boundaryPoints.length < 3000) throw new Error(`Unexpected Tokyo ward boundary: ${rings.length} rings, ${boundaryPoints.length} coordinates`);
const bounds: Bounds = {
  minX: Math.min(...boundaryPoints.map(([x]) => x)), minY: Math.min(...boundaryPoints.map(([, y]) => y)),
  maxX: Math.max(...boundaryPoints.map(([x]) => x)), maxY: Math.max(...boundaryPoints.map(([, y]) => y)),
};

const sql = `LOAD spatial;
SET geometry_always_xy=true;
WITH boundary AS (
  SELECT ST_Transform(geom, 'EPSG:4326', 'EPSG:3857') AS shape
  FROM ST_Read('${BOUNDARY}')
), facilities AS (
  SELECT ST_X(p.way) AS x, ST_Y(p.way) AS y,
    CASE
      WHEN p.amenity IN ('restaurant','cafe','fast_food','food_court','ice_cream','pub','bar','biergarten') THEN 0
      WHEN p.public_transport IS NOT NULL OR p.railway IS NOT NULL OR p.highway='bus_stop'
        OR p.amenity IN ('bicycle_rental','taxi') THEN 2
      WHEN p.shop IS NOT NULL THEN 1
      WHEN p.amenity IS NOT NULL OR p.tourism IS NOT NULL OR p.leisure IS NOT NULL THEN 3
    END AS kind
  FROM read_parquet('${POINTS}') p, boundary b
  WHERE ST_Within(p.way, b.shape)
)
SELECT x, y, kind FROM facilities WHERE kind IS NOT NULL ORDER BY kind, y, x`;
const csv = execFileSync('duckdb', ['-noheader', '-csv', '-c', sql], { encoding: 'utf8', maxBuffer: 32 << 20 }).trimEnd();
const facilities: Facility[] = csv.split('\n').filter(Boolean).map((row) => {
  const [x, y, kind] = row.split(',').map(Number);
  if (!Number.isFinite(x + y + kind)) throw new Error(`Malformed facility row: ${row}`);
  return { x, y, kind: kind as Facility['kind'] };
});
if (facilities.length < 140_000) throw new Error(`Unexpected OSM facility count: ${facilities.length}`);
if (facilities.some(({ x, y }) => x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY)) {
  throw new Error('OSM point escaped the 23-ward source boundary');
}

const categoryCounts = [0, 0, 0, 0];
for (const { kind } of facilities) categoryCounts[kind]++;
const points = encodeFacilities(facilities, bounds), outline = encodeOutline(rings, bounds);
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/facilities.bin`, new Uint8Array(points));
writeFileSync(`${OUTPUT}/boundary.bin`, new Uint8Array(outline));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify({
  sourceDate: '2026-08-31', sourceFeatures: facilities.length,
  categoryCounts, categoryNames: ['飲食', '買い物', '交通', '公共・観光'],
  bounds, boundaryRings: rings.length, boundarySegments: new DataView(outline).getUint32(4, true),
  pointsBytes: points.byteLength, boundaryBytes: outline.byteLength,
}));
console.log(`Tokyo OSM facilities: ${facilities.length} nodes; food ${categoryCounts[0]}, retail ${categoryCounts[1]}, transport ${categoryCounts[2]}, civic/visitor ${categoryCounts[3]}; ${rings.length} boundary rings`);
