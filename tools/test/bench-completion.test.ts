import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadSpec } from '../../harness/lib/spec.ts';

const root = join(import.meta.dirname, '../..');
const specs: string[] = [];

function walk(dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (entry.name === 'spec.yaml') specs.push(dir);
  }
}

walk(join(root, 'examples'));

test('every browser benchmark with scenarios signals completion', () => {
  const incomplete: string[] = [];
  const missingGpu: string[] = [];
  for (const dir of specs) {
    const spec = loadSpec(dir);
    if (spec.runtime !== 'browser' || !spec.definition?.benchmarks.scenarios?.length) continue;
    const bench = join(dir, 'bench.ts');
    assert.ok(existsSync(bench), `${spec.id}: benchmark scenarios need bench.ts`);
    const source = readFileSync(bench, 'utf8');
    // The point-cloud example delegates its checks and terminal signal to the
    // shared measure() helper in example 23.
    if (!/emit\s*\(\s*\{\s*done\s*:\s*true\s*\}\s*\)/.test(source) && !source.includes('measure<Mesh>(')) {
      incomplete.push(spec.id);
    }
    if (spec.gpu === 'hardware' && !/info\s*:\s*\{[^}]*\bgpu\s*:/s.test(source)) missingGpu.push(spec.id);
  }
  assert.deepEqual(incomplete, [], `benchmarks missing done signal: ${incomplete.join(', ')}`);
  assert.deepEqual(missingGpu, [], `hardware GPU benchmarks missing renderer info: ${missingGpu.join(', ')}`);
});
