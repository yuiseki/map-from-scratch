import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatObservation, type Observation } from '../observational.ts';

const root = join(import.meta.dirname, '../..');

test('an observational result is clearly distinct from an in-page benchmark', () => {
  const observation: Observation = {
    id: '18-fuji-aerial-terrain',
    date: '2026-10-29',
    duration_s: 30,
    first_contentful_paint_ms: 24.39,
    completed_requests: 86,
    transfer_mib: 5.02,
    note: '',
  };
  assert.equal(formatObservation(observation), '観測 2026-10-29・30秒: FCP 24 ms・86 requests・5.02 MiB');
});

test('the observation dataset covers the ten examples without in-page benchmarks', () => {
  const dataset = JSON.parse(readFileSync(join(root, 'docs/measurements/observational-2026-10-29.json'), 'utf8')) as {
    method: string;
    cases: Observation[];
  };
  assert.match(dataset.method, /no in-page benchmark hooks/);
  assert.deepEqual(dataset.cases.map(({ id }) => id), [
    '08-prefecture-quiz', '09-prefecture-search', '10-gsi-seamlessphoto',
    '18-fuji-aerial-terrain', '19-kontur-h3-population', '20-ucdp-ged-timeline',
    '21-mapterhorn-planet-terrain', '22-plateau-tokyo-tiles', '23-taito-point-cloud',
    '24-osm-planet',
  ]);
  for (const result of dataset.cases) {
    assert.ok(result.duration_s > 0 && result.completed_requests >= 0 && result.transfer_mib >= 0, result.id);
    assert.match(formatObservation(result), /^観測 2026-10-29・/);
  }
});
