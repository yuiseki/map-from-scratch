import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const dir = dirname(fileURLToPath(import.meta.url));
const binary = resolve(dir, '../../build/06-mcu-roadmap/mcumap-unit-test');

test('integer strip renderer draws a centered motorway and reports its work', () => {
  mkdirSync(dirname(binary), { recursive: true });
  execFileSync('cc', [
    '-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-I', dir,
    resolve(dir, 'mcumap.test.c'), resolve(dir, 'mcumap.c'), '-o', binary,
  ]);
  assert.equal(execFileSync(binary, { encoding: 'utf8' }), '');
});
