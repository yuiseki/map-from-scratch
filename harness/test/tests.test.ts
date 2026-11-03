import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findTests } from '../lib/tests.ts';

const tree = (files: string[]): string => {
  const d = mkdtempSync(join(tmpdir(), 'tests-'));
  for (const f of files) {
    mkdirSync(join(d, f, '..'), { recursive: true });
    writeFileSync(join(d, f), '');
  }
  return d;
};

test('every *.test.ts in the repository is a test, wherever it sits next to its code', () => {
  const d = tree([
    'harness/test/yaml.test.ts',
    'examples/23-taito-point-cloud/decode.ts',
    'examples/23-taito-point-cloud/decode.test.ts',
    'examples/webgpu/004-osm-node-density/density.test.ts',
    'kits/geoparquet/zstd.test.ts',
    'tools/test/geo.test.ts',
  ]);
  assert.deepEqual(findTests(d), [
    'examples/23-taito-point-cloud/decode.test.ts',
    'examples/webgpu/004-osm-node-density/density.test.ts',
    'harness/test/yaml.test.ts',
    'kits/geoparquet/zstd.test.ts',
    'tools/test/geo.test.ts',
  ]);
});

test('generated, downloaded and third-party trees are not searched', () => {
  const d = tree([
    'node_modules/x/a.test.ts', '.cache/site/a.test.ts', '.git/a.test.ts', 'data/raw/a.test.ts',
    'results/a.test.ts', 'build/a.test.ts', 'ref-repos/maplibre/a.test.ts', 'vendor/earcut/a.test.ts',
    'examples/01-x/a.test.ts',
  ]);
  assert.deepEqual(findTests(d), ['examples/01-x/a.test.ts']);
});

test('only .test.ts files count', () => {
  const d = tree(['examples/01-x/a.test.js', 'examples/01-x/a.spec.ts', 'examples/01-x/test.ts', 'examples/01-x/b.test.ts']);
  assert.deepEqual(findTests(d), ['examples/01-x/b.test.ts']);
});
