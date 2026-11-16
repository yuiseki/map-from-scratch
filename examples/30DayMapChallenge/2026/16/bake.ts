import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateContributions, type ContributionCollection } from './collaboration.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../');
const OUTPUT = resolve(ROOT, 'data/baked/30DayMapChallenge-2026-16');
const BOUNDS = { west: 139.696, south: 35.65, east: 139.706, north: 35.66 };
const GRID_SIZE = 24;
const REQUEST = {
  url: 'https://api.ohsome.org/v1/contributions/centroid',
  bbox: '139.696,35.65,139.706,35.66',
  time: '2025-01-01,2026-01-01',
  filter: 'building=*',
  properties: 'contributionTypes',
  clipGeometry: 'true',
};
const MAX_RESPONSE_BYTES = 1_000_000;

async function downloadBounded(): Promise<Uint8Array> {
  const url = new URL(REQUEST.url);
  url.searchParams.set('bboxes', REQUEST.bbox);
  url.searchParams.set('time', REQUEST.time);
  url.searchParams.set('filter', REQUEST.filter);
  url.searchParams.set('properties', REQUEST.properties);
  url.searchParams.set('clipGeometry', REQUEST.clipGeometry);
  const response = await fetch(url, {
    headers: { 'user-agent': 'map-from-scratch/30day-day16 (+https://github.com/yuiseki/map-from-scratch)' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok || !response.body) throw new Error(`ohsome API returned HTTP ${response.status}`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error(`ohsome response exceeded ${MAX_RESPONSE_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.byteLength; }
  return output;
}

const inputPath = process.argv[2];
const sourceBytes = inputPath ? readFileSync(inputPath) : await downloadBounded();
if (sourceBytes.byteLength > MAX_RESPONSE_BYTES) throw new Error(`Source exceeds ${MAX_RESPONSE_BYTES} bytes`);
const source = JSON.parse(new TextDecoder().decode(sourceBytes)) as ContributionCollection & { apiVersion?: string };
const map = aggregateContributions(source, BOUNDS, GRID_SIZE);
if (map.inputFeatures < 1 || map.mappedFeatures < 1) throw new Error('The selected OSM history window returned no mappable contributions');

const payload = {
  schemaVersion: 1,
  bounds: map.bounds,
  gridSize: map.gridSize,
  cells: map.cells,
  monthlyTotals: map.monthlyTotals,
};
const payloadBytes = Buffer.from(JSON.stringify(payload));
const stats = {
  source: 'OpenStreetMap historical contributions via ohsome API',
  sourceUrl: 'https://api.ohsome.org/v1/contributions/centroid',
  docsUrl: 'https://docs.ohsome.org/ohsome-api/development/endpoints.html',
  apiVersion: source.apiVersion ?? 'not reported',
  retrievedAt: '2026-11-05',
  license: 'Open Database License 1.0 (ODbL)',
  attribution: '© OpenStreetMap contributors',
  query: REQUEST,
  boundsWgs84: BOUNDS,
  coordinateReferenceSystem: 'WGS84 longitude/latitude',
  gridSize: GRID_SIZE,
  inputFeatureCount: map.inputFeatures,
  mappedFeatureCount: map.mappedFeatures,
  unmappedNoGeometry: map.unmappedNoGeometry,
  unmappedOutsideYear: map.unmappedOutsideYear,
  unmappedOutsideBounds: map.unmappedOutsideBounds,
  cellCount: map.cells.length,
  locatedEditTypeCounts: map.monthlyTotals.reduce((sum, month) => ({
    creation: sum.creation + month.creation,
    geometryChange: sum.geometryChange + month.geometryChange,
    tagChange: sum.tagChange + month.tagChange,
    deletion: sum.deletion + month.deletion,
    other: sum.other + month.other,
  }), { creation: 0, geometryChange: 0, tagChange: 0, deletion: 0, other: 0 }),
  responseBytes: sourceBytes.byteLength,
  payloadBytes: payloadBytes.byteLength,
  privacy: 'Raw OSM element IDs, changeset IDs, tags and person-related metadata are not retained.',
  aggregation: 'Contribution centroids are assigned to a 24 × 24 grid. Grid marks are approximate locations, not exact edit footprints. Deletions without returned geometry are omitted from the spatial map.',
};

mkdirSync(OUTPUT, { recursive: true });
writeFileSync(resolve(OUTPUT, 'collaboration.json'), payloadBytes);
writeFileSync(resolve(OUTPUT, 'stats.json'), JSON.stringify(stats, null, 2) + '\n');
console.log(`OSM contributions: ${map.mappedFeatures}/${map.inputFeatures} located; ${map.cells.length} cells; ${payloadBytes.byteLength} B`);
