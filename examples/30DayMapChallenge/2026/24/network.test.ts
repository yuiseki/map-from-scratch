import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMembershipNetwork,
  buildNetworkStats,
  clipPolylineToBounds,
  decodeNetwork,
  deduplicateRoutes,
  deduplicateStops,
  encodeNetwork,
  encodeNetworkStats,
  extractNetwork,
  inspectStop,
  parseNetwork,
  projectNetworkPoint,
  projectJgd2011,
  fitNetworkCamera,
  hitNetworkStop,
  type NetworkData,
} from './network.ts';

const source: NetworkData = {
  routes: [
    { id: '13-001', operator: 'A社', prefCode: '13', coordinates: [[[139.7, 35.6], [139.8, 35.7]]] },
    { id: '13-002', operator: 'B社', prefCode: '13', coordinates: [[[139.75, 35.65], [139.85, 35.75]]] },
  ],
  stops: [
    { id: '13-s1', operator: 'A社', name: '中央', prefCode: '13', coordinates: [139.7, 35.6], routes: ['A01', 'A02'], kinds: [1, 1], nRoutes: 2 },
    { id: '13-s2', operator: 'A社', name: '東口', prefCode: '13', coordinates: [139.8, 35.7], routes: ['A01'], kinds: [1], nRoutes: 1 },
    { id: '13-s3', operator: 'B社', name: '中央', prefCode: '13', coordinates: [139.75, 35.65], routes: ['A01'], kinds: [2], nRoutes: 1 },
  ],
};

test('projects EPSG:6668 longitude/latitude to Web Mercator with y northing', () => {
  const [x, y] = projectJgd2011([139.7, 35.6]);
  assert.ok(Math.abs(x - 15_551_333) < 2);
  assert.ok(Math.abs(y - 4_245_721) < 2);
  const origin = projectJgd2011([0, 0]);
  assert.equal(origin[0], 0);
  assert.ok(Math.abs(origin[1]) < 1e-8);
  assert.throws(() => projectJgd2011([181, 0]), /coordinate/i);
});

test('fits a north-up camera and hits the nearest stop by screen distance', () => {
  const camera = fitNetworkCamera({ minX: 0, minY: 0, maxX: 100, maxY: 50 }, 300, 200, 10);
  assert.deepEqual(projectNetworkPoint([50, 25], camera), [150, 100]);
  const points = [
    { stop: source.stops[0]!, screenX: 10, screenY: 10 },
    { stop: source.stops[1]!, screenX: 14, screenY: 10 },
  ];
  assert.equal(hitNetworkStop(12, 10, points, 4)?.stop.id, '13-s2');
  assert.equal(hitNetworkStop(30, 10, points, 4), null);
  assert.throws(() => fitNetworkCamera({ minX: 0, minY: 1, maxX: 0, maxY: 0 }, 300, 200), /extent/i);
});

test('validates source rows without implying a join between N07 line ids and P11 stops', () => {
  const parsed = parseNetwork(source);
  assert.equal(parsed.routes.length, 2);
  assert.equal(parsed.stops.length, 3);
  assert.deepEqual(parsed.routes[0]?.coordinates[0]?.[0], [139.7, 35.6]);
  assert.throws(() => parseNetwork({ ...source, stops: [{ ...source.stops[0]!, nRoutes: 7 }] }), /nRoutes/i);
  assert.throws(() => parseNetwork({ ...source, routes: [{ ...source.routes[0]!, coordinates: [[139.7, 35.6]] }] }), /line/i);
});

test('models only exact operator and route-label memberships as a bipartite graph', () => {
  const graph = buildMembershipNetwork(parseNetwork(source).stops);
  assert.equal(graph.routeNodes.length, 3);
  assert.equal(graph.memberships.length, 4);
  assert.deepEqual(graph.routeNodes.find((node) => node.operator === 'A社' && node.label === 'A01')?.stopIds, ['13-s1', '13-s2']);
  assert.equal(graph.routeNodes.some((node) => node.operator === 'B社' && node.label === 'A01'), true);
  assert.equal(graph.routeNodes.find((node) => node.operator === 'B社' && node.label === 'A01')?.stopIds.length, 1);
  assert.equal('routeId' in graph.memberships[0]!, false);
});

test('deduplicates only identical source line ids and rejects id collisions', () => {
  const lines = [source.routes[0]!, { ...source.routes[0]! }, source.routes[1]!];
  assert.deepEqual(deduplicateRoutes(lines).map((line) => line.id), ['13-001', '13-002']);
  assert.throws(() => deduplicateRoutes([lines[0]!, { ...lines[0]!, operator: '別会社' }]), /conflicting/i);
});

test('deduplicates stops only by source id and preserves co-located records with distinct ids', () => {
  const sameSource = { ...source.stops[0]!, coordinates: [...source.stops[0]!.coordinates] as [number, number], routes: [...source.stops[0]!.routes], kinds: [...source.stops[0]!.kinds] };
  const coLocated = { ...sameSource, id: '13-s4' };
  assert.deepEqual(deduplicateStops([source.stops[0]!, sameSource, coLocated]).map((stop) => stop.id), ['13-s1', '13-s4']);
  assert.throws(() => deduplicateStops([source.stops[0]!, { ...source.stops[0]!, name: '別名' }]), /conflicting/i);
});

test('clips geographic line parts to the fixed map extent and drops disjoint segments', () => {
  const clipped = clipPolylineToBounds([[-2, 5], [5, 5], [12, 5], [12, 12]], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  assert.deepEqual(clipped, [[[0, 5], [5, 5], [10, 5]]]);
  assert.deepEqual(clipPolylineToBounds([[-2, -2], [-1, -1]], { minX: 0, minY: 0, maxX: 10, maxY: 10 }), []);
  assert.throws(() => clipPolylineToBounds([[0, 0], [1, 1]], { minX: 2, minY: 0, maxX: 1, maxY: 1 }), /extent/i);
});

test('round-trips an encoded network and inspects exact stop membership fields', () => {
  const parsed = parseNetwork(source);
  assert.deepEqual(decodeNetwork(encodeNetwork(parsed)), parsed);
  assert.deepEqual(inspectStop(parsed.stops, '13-s1'), {
    id: '13-s1', name: '中央', operator: 'A社', nRoutes: 2,
    routes: ['A01', 'A02'], kinds: [1, 1], prefCode: '13',
  });
  assert.equal(inspectStop(parsed.stops, 'missing'), null);
  assert.throws(() => decodeNetwork('{'), /JSON/i);
});

test('extracts source-schema rows, clips N07 geometries, and bounds P11 point records', () => {
  const extracted = extractNetwork(
    [
      { id: '13-r1', pref_code: '13', operator: 'A社', geometry: { type: 'LineString', coordinates: [[-5, 5], [5, 5], [15, 5]] } },
      { id: '13-r-out', pref_code: '13', operator: 'A社', geometry: { type: 'LineString', coordinates: [[-5, -5], [-2, -2]] } },
    ],
    [
      { id: '13-s1', pref_code: '13', operator: 'A社', name: '中央', routes: ['A01', 'A02'], kinds: [1, 2], n_routes: 2, geometry: { type: 'Point', coordinates: [5, 5] } },
      { id: '13-s-out', pref_code: '13', operator: 'A社', name: '外', routes: [], kinds: [], n_routes: 0, geometry: { type: 'Point', coordinates: [20, 5] } },
    ],
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  );
  assert.equal(extracted.routes.length, 1);
  assert.deepEqual(extracted.routes[0]?.coordinates, [[[0, 5], [5, 5], [10, 5]]]);
  assert.equal(extracted.stops.length, 1);
  assert.deepEqual(extracted.stops[0]?.routes, ['A01', 'A02']);
  assert.deepEqual(extracted.stops[0]?.kinds, [1, 2]);
  assert.throws(() => extractNetwork([{ id: '13-bad', pref_code: '13', operator: 'A社', geometry: { type: 'Point', coordinates: [5, 5] } }], [], { minX: 0, minY: 0, maxX: 10, maxY: 10 }), /LineString/i);
  assert.throws(() => extractNetwork([{ id: '14-r', pref_code: '14', operator: 'A社', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } }], [], { minX: 0, minY: 0, maxX: 10, maxY: 10 }), /Tokyo prefecture/i);
});

test('records source provenance, selection counts and geometry clipping in deterministic stats', () => {
  const extracted = extractNetwork(
    [{ id: '13-r1', pref_code: '13', operator: 'A社', geometry: { type: 'LineString', coordinates: [[-5, 5], [5, 5], [15, 5]] } }],
    [{ id: '13-s1', pref_code: '13', operator: 'A社', name: '中央', routes: ['A01'], kinds: [1], n_routes: 1, geometry: { type: 'Point', coordinates: [5, 5] } }],
    { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  );
  const payload = encodeNetwork(extracted);
  const stats = buildNetworkStats(extracted, { n07Rows: 1, p11Rows: 1 }, { minX: 0, minY: 0, maxX: 10, maxY: 10 }, Buffer.byteLength(payload));
  assert.equal(stats.coordinateReferenceSystem, 'EPSG:6668 geographic longitude/latitude; projected to EPSG:3857 for display');
  assert.equal(stats.sources.n07.attribution, '出典：「国土数値情報（バスルートデータ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html）を加工して作成');
  assert.equal(stats.sources.n07.license, 'CC BY 4.0');
  assert.equal(stats.sources.p11.selectedRows, 1);
  assert.equal(stats.counts.stopRouteMemberships, 1);
  assert.equal(stats.counts.n07ClippedVertices, 3);
  assert.equal(stats.payloadBytes, Buffer.byteLength(payload));
  const first = encodeNetworkStats(stats);
  assert.equal(first, encodeNetworkStats(stats));
  assert.deepEqual(JSON.parse(first).sources, stats.sources);
});
