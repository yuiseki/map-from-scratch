import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { acousticWeight, encodeSoundGrid } from './soundscape.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-11';
const EARTH_RADIUS = 6_378_137;
const GRID = 320;
const bounds = { west: 139.55, east: 139.92, south: 35.52, north: 35.82 };
const mercator = (lon: number, lat: number): [number, number] => [
  EARTH_RADIUS * lon * Math.PI / 180,
  EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)),
];
const [minX, minY] = mercator(bounds.west, bounds.south);
const [maxX, maxY] = mercator(bounds.east, bounds.north);
const lineFile = source('osm-tokyo23-lines');
const highways = Object.keys({ motorway: 1, trunk: 1, primary: 1, secondary: 1, tertiary: 1, unclassified: 1,
  residential: 1, living_street: 1, service: 1, busway: 1, motorway_link: 1, trunk_link: 1,
  primary_link: 1, secondary_link: 1, tertiary_link: 1 });
const railways = ['rail', 'subway', 'light_rail', 'monorail', 'tram', 'funicular'];
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
const sql = `LOAD spatial;
SELECT coalesce(highway,''), coalesce(railway,''), ST_AsGeoJSON(way)
FROM read_parquet('${lineFile}')
WHERE bbox.xmin <= ${maxX} AND bbox.xmax >= ${minX}
  AND bbox.ymin <= ${maxY} AND bbox.ymax >= ${minY}
  AND (highway IN (${highways.map(quote).join(',')}) OR railway IN (${railways.map(quote).join(',')}))
ORDER BY osm_id`;
const output = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', sql], {
  encoding: 'utf8', maxBuffer: 256 << 20,
}).trimEnd();
const roads = new Uint16Array(GRID * GRID), rails = new Uint16Array(GRID * GRID);
let roadWays = 0, railWays = 0, samples = 0;
const rows = output.split('\n').filter(Boolean);
for (const line of rows) {
  const first = line.indexOf('|'), second = line.indexOf('|', first + 1);
  if (first < 0 || second < 0) throw new Error(`Malformed OSM way row: ${line.slice(0, 100)}`);
  const highway = line.slice(0, first), railway = line.slice(first + 1, second);
  const kind = railway ? 'rail' : 'road', category = railway || highway;
  const weight = acousticWeight({ kind, class: category });
  if (weight <= 0) continue;
  const geometry = JSON.parse(line.slice(second + 1)) as { type: string; coordinates: [number, number][] };
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) continue;
  if (kind === 'rail') railWays++; else roadWays++;
  const channel = kind === 'rail' ? rails : roads;
  for (let i = 1; i < geometry.coordinates.length; i++) {
    const a = geometry.coordinates[i - 1]!, b = geometry.coordinates[i]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(length / 28));
    const amount = weight * length / steps / 4;
    for (let step = 0; step < steps; step++) {
      const t = (step + 0.5) / steps, x = a[0] + dx * t, y = a[1] + dy * t;
      const col = Math.floor((x - minX) / (maxX - minX) * GRID);
      const row = Math.floor((maxY - y) / (maxY - minY) * GRID);
      if (col < 0 || col >= GRID || row < 0 || row >= GRID) continue;
      const index = row * GRID + col;
      channel[index] = Math.min(65535, channel[index]! + amount);
      samples++;
    }
  }
}
if (rows.length < 1_000 || roadWays < 1_000 || railWays < 100) {
  throw new Error(`Unexpected Tokyo soundscape coverage: ${rows.length} OSM ways (${roadWays} roads, ${railWays} railways)`);
}
const encoded = encodeSoundGrid({ width: GRID, height: GRID, roads, rails });
let maxRoad = 0, maxRail = 0;
for (let i = 0; i < roads.length; i++) { maxRoad = Math.max(maxRoad, roads[i]!); maxRail = Math.max(maxRail, rails[i]!); }
const stats = {
  sourceDate: '2026-08-31', sourceWays: rows.length, roadWays, railWays, sampledSegments: samples,
  gridWidth: GRID, gridHeight: GRID, bounds, projection: 'EPSG:3857',
  roadCells: roads.reduce((n, value) => n + (value > 0 ? 1 : 0), 0),
  railCells: rails.reduce((n, value) => n + (value > 0 ? 1 : 0), 0),
  maxRoad, maxRail, outputBytes: encoded.byteLength,
  model: 'OSM road/rail class weighted line length; synthetic audio; not measured noise or dB',
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/soundscape.bin`, new Uint8Array(encoded));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`Tokyo modeled soundscape: ${rows.length} ways (${roadWays} roads, ${railWays} rail), ${stats.roadCells} road + ${stats.railCells} rail cells, ${encoded.byteLength} bytes`);
