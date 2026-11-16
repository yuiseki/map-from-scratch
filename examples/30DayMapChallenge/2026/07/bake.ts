import { mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { source } from '../../../../tools/sources.ts';
import { buildWalkGraph, calculateWalkshed, clipRoadWays, encodeWalkSegments, type Point, type RoadWay } from './walk.ts';

const OUTPUT = 'data/baked/30DayMapChallenge-2026-07';
const EARTH_RADIUS = 6_378_137;
const ORIGIN: [number, number] = [139.7774, 35.7138]; // Ueno Station, WGS 84
const WALK_MINUTES = 10, SPEED_MPS = 1.2, AREA_RADIUS_M = 1_300;
const phi = ORIGIN[1] * Math.PI / 180;
const center: Point = [EARTH_RADIUS * ORIGIN[0] * Math.PI / 180, EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + phi / 2))];
const bounds = { minX: center[0] - AREA_RADIUS_M, minY: center[1] - AREA_RADIUS_M, maxX: center[0] + AREA_RADIUS_M, maxY: center[1] + AREA_RADIUS_M };
const roadsFile = source('osm-tokyo23-lines');
const sql = `LOAD spatial;
SELECT highway, coalesce(foot,''), coalesce(access,''), ST_AsGeoJSON(way)
FROM read_parquet('${roadsFile}')
WHERE highway IS NOT NULL
  AND bbox.xmin <= ${bounds.maxX} AND bbox.xmax >= ${bounds.minX}
  AND bbox.ymin <= ${bounds.maxY} AND bbox.ymax >= ${bounds.minY}
ORDER BY osm_id`;
const output = execFileSync('duckdb', ['-noheader', '-list', '-separator', '|', '-c', sql], { encoding: 'utf8', maxBuffer: 64 << 20 }).trimEnd();
const ways: RoadWay[] = output.split('\n').filter(Boolean).map((line) => {
  const [highway, foot, access, json] = line.split('|');
  if (!highway || !json) throw new Error(`Malformed local OSM line row: ${line.slice(0, 100)}`);
  const geometry = JSON.parse(json) as { type: string; coordinates: unknown };
  if (geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)) throw new Error(`Expected OSM LineString, got ${geometry.type}`);
  const coordinates = geometry.coordinates as Point[];
  return { highway, foot: foot || null, access: access || null, coordinates };
});
if (ways.length < 1_000) throw new Error(`Unexpected OSM road coverage in Ueno bbox: ${ways.length} ways`);
const clipped = clipRoadWays(ways, bounds);
const graph = buildWalkGraph(clipped);
if (graph.edges.length < 1_000) throw new Error(`Unexpected eligible walking network: ${graph.edges.length} edges from ${clipped.length} segments`);
const result = calculateWalkshed(graph, center, WALK_MINUTES, SPEED_MPS, Math.cos(phi));
const snapDistanceM = Math.hypot(result.origin[0] - center[0], result.origin[1] - center[1]) * Math.cos(phi);
if (snapDistanceM > 100 || result.reachedNodeCount < 100 || !result.segments.some((edge) => edge.reachable)) throw new Error(`Ueno origin did not connect to a plausible walkshed: snap ${snapDistanceM.toFixed(1)}m, reached ${result.reachedNodeCount}`);
const encoded = encodeWalkSegments(result.segments, bounds, WALK_MINUTES * 60);
const reachableSegments = result.segments.filter((edge) => edge.reachable).length;
const unreachableSegments = result.segments.length - reachableSegments;
const stats = {
  sourceDate: '2026-08-31', sourceWays: ways.length, clippedWaySegments: clipped.length,
  graphNodes: result.nodeCount, graphEdges: graph.edges.length, reachedNodes: result.reachedNodeCount,
  reachableSegments, unreachableSegments, originName: '上野駅', originWgs84: ORIGIN,
  originMercator: center, originSnapMeters: snapDistanceM, walkMinutes: WALK_MINUTES,
  walkingSpeedMps: SPEED_MPS, projectionGroundScale: Math.cos(phi), bounds,
  recordStrideBytes: 12, outputBytes: encoded.byteLength, routeVersion: 'uniform-speed-weighted-dijkstra-v1',
};
mkdirSync(OUTPUT, { recursive: true });
writeFileSync(`${OUTPUT}/walkshed.bin`, new Uint8Array(encoded));
writeFileSync(`${OUTPUT}/stats.json`, JSON.stringify(stats));
console.log(`Ueno 10-minute network: ${ways.length} source ways, ${graph.nodes.length} nodes, ${graph.edges.length} walk edges; ${result.reachedNodeCount} reached nodes, ${reachableSegments} reachable of ${result.segments.length} rendered segments, origin snap ${snapDistanceM.toFixed(1)} m`);
