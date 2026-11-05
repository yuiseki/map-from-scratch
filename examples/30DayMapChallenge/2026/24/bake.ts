import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { source } from '../../../../tools/sources.ts';
import {
  buildMembershipNetwork, buildNetworkStats, encodeNetwork, encodeNetworkStats,
  extractNetwork, TOKYO_NETWORK_BOUNDS,
} from './network.ts';

const n07Path = source('ksj-n07-bus-route-tokyo-2022');
const p11Path = source('ksj-p11-bus-stops-tokyo-2022');
const outputDir = resolve('data/baked/30DayMapChallenge-2026-24');
const quote = (value: string) => value.replaceAll("'", "''");

interface RouteRow { id: string; operator: string; pref_code: string; geometry: unknown }
interface StopRow {
  id: string; operator: string; name: string; pref_code: string;
  routes: unknown; kinds: unknown; n_routes: number; geometry: unknown;
}

function rows<T>(path: string, query: string): T[] {
  const output = execFileSync('duckdb', ['-json', '-c', `LOAD spatial; ${query.replaceAll('$FILE', quote(path))}`], {
    encoding: 'utf8', maxBuffer: 128 << 20,
  });
  const start = output.indexOf('[{'), end = output.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`DuckDB returned no JSON rows: ${output.slice(0, 300)}`);
  return JSON.parse(output.slice(start, end + 1)) as T[];
}

const routeRows = rows<RouteRow>(n07Path, `
  SELECT id, operator, pref_code, ST_AsGeoJSON(geometry)::JSON AS geometry
  FROM read_parquet('$FILE') ORDER BY id`);
const stopRows = rows<StopRow>(p11Path, `
  SELECT id, operator, name, pref_code, routes, kinds, n_routes,
    ST_AsGeoJSON(geometry)::JSON AS geometry
  FROM read_parquet('$FILE') ORDER BY id`);
if (routeRows.length !== 17_540 || stopRows.length !== 12_389) {
  throw new Error(`Unexpected Tokyo source row counts: N07 ${routeRows.length}, P11 ${stopRows.length}`);
}

const network = extractNetwork(routeRows, stopRows, TOKYO_NETWORK_BOUNDS);
const memberships = buildMembershipNetwork(network.stops);
const payload = encodeNetwork(network);
const payloadBytes = Buffer.byteLength(payload);
const stats = buildNetworkStats(network, { n07Rows: routeRows.length, p11Rows: stopRows.length }, TOKYO_NETWORK_BOUNDS, payloadBytes);
const expected = {
  routeLines: 9_545, stops: 6_664, n07Operators: 57, p11Operators: 57,
  stopRouteMemberships: 15_286, exactOperatorRouteLabelGroups: 915,
  stopsWithMultipleRouteLabels: 3_180, maxRecordedRouteLabels: 27,
};
for (const [key, value] of Object.entries(expected)) {
  if (stats.counts[key as keyof typeof stats.counts] !== value) {
    throw new Error(`Unexpected ${key}: ${stats.counts[key as keyof typeof stats.counts]}, expected ${value}`);
  }
}
if (memberships.memberships.length !== stats.counts.stopRouteMemberships
    || memberships.routeNodes.length !== stats.counts.exactOperatorRouteLabelGroups) {
  throw new Error('P11 incidence graph does not match baked statistics');
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'network.json'), payload);
writeFileSync(resolve(outputDir, 'stats.json'), encodeNetworkStats(stats));
console.log(`KSJ Tokyo Network: ${stats.counts.routeLines.toLocaleString()} clipped N07 lines, ${stats.counts.stops.toLocaleString()} P11 stops, ${stats.counts.stopRouteMemberships.toLocaleString()} stop-label records, ${payloadBytes.toLocaleString()} JSON bytes`);
