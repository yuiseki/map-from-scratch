import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const daysDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../examples/30DayMapChallenge/2026');
const isolatedReadbackBenches = new Set(['07/bench.ts', '30/bench.ts']);

test('30DayMapChallenge pixel checks do not read rendered canvases directly', () => {
  const failures: string[] = [];
  for (const day of readdirSync(daysDir, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
    const dayDir = resolve(daysDir, day.name);
    for (const file of readdirSync(dayDir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))) {
      const sourceFile = resolve(dayDir, file.name);
      const source = readFileSync(sourceFile, 'utf8');
      if (/\.getImageData\s*\(/.test(source)) {
        const path = relative(daysDir, sourceFile);
        if (!isolatedReadbackBenches.has(path)) failures.push(path);
      }
    }
  }
  assert.deepEqual(failures, [], `Use readBack() for visible canvases; direct readback found in: ${failures.join(', ')}`);
});
