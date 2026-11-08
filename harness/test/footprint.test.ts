import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { measureFootprint, checkDependencies, isSoftwareGpu } from '../lib/footprint.ts';

test('footprint sums raw and gzip bytes of shipped code and data', () => {
  const d = mkdtempSync(join(tmpdir(), 'fp-'));
  writeFileSync(join(d, 'a.js'), 'x'.repeat(1000));
  writeFileSync(join(d, 'b.wgsl'), 'y'.repeat(500));
  writeFileSync(join(d, 'd.bin'), Buffer.alloc(2048));
  const m = measureFootprint(d, { code: ['a.js', 'b.wgsl'], data: ['d.bin'] });
  assert.equal(m.code_bytes, 1500);
  assert.ok(m.code_gzip_bytes > 0 && m.code_gzip_bytes < 200);
  assert.equal(m.data_bytes, 2048);
  assert.ok(m.data_gzip_bytes > 0 && m.data_gzip_bytes < 100);
  assert.equal(m.total_gzip_bytes, m.code_gzip_bytes + m.data_gzip_bytes);
});

test('a listed file that does not exist is an error, not zero bytes', () => {
  const d = mkdtempSync(join(tmpdir(), 'fp-'));
  assert.throws(() => measureFootprint(d, { code: ['missing.js'] }), /missing.js/);
});

test('no external dependency is allowed, earcut included (it is kits/earcut)', () => {
  assert.deepEqual(checkDependencies([]), []);
  assert.deepEqual(checkDependencies(['earcut']), ['earcut']);
  assert.deepEqual(checkDependencies(['earcut', 'three']), ['earcut', 'three']);
});

test('software rasterisers are recognised', () => {
  assert.equal(isSoftwareGpu('ANGLE (NVIDIA, Vulkan 1.4 (NVIDIA GeForce RTX 3060))'), false);
  assert.equal(isSoftwareGpu('ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))'), true);
  assert.equal(isSoftwareGpu('llvmpipe (LLVM 19.1.7, 256 bits)'), true);
  assert.equal(isSoftwareGpu(undefined), false);
});

test('parseSizeA sums sections by kind from llvm-size -A output', async () => {
  const { parseSizeA } = await import('../lib/footprint.ts');
  const out = `mcumap.o  :
section             size   addr
.text                 12      0
.text.mm_render     1800      0
.rodata              240      0
.rodata.str1.1        10      0
.sdata                 4      0
.bss                  64      0
.sbss                  8      0
.comment              40      0
Total               2128
`;
  assert.deepEqual(parseSizeA(out), { text: 1812, rodata: 250, ram: 76 });
});

test('a listed directory counts every file under it', async () => {
  const { mkdirSync } = await import('node:fs');
  const d = mkdtempSync(join(tmpdir(), 'fp-'));
  mkdirSync(join(d, 'tiles/3'), { recursive: true });
  writeFileSync(join(d, 'tiles/3/1.bin'), Buffer.alloc(10));
  writeFileSync(join(d, 'tiles/3/2.bin'), Buffer.alloc(20));
  writeFileSync(join(d, 'tiles/index.bin'), Buffer.alloc(5));
  assert.equal(measureFootprint(d, { code: [], data: ['tiles'] }).data_bytes, 35);
});

test('a listed directory does not count the tests kept next to the code', async () => {
  const { mkdirSync } = await import('node:fs');
  const d = mkdtempSync(join(tmpdir(), 'fp-'));
  mkdirSync(join(d, 'src'));
  writeFileSync(join(d, 'src/decode.ts'), 'x'.repeat(100));
  writeFileSync(join(d, 'src/decode.test.ts'), 'y'.repeat(1000));
  assert.equal(measureFootprint(d, { code: ['src'], data: [] }).code_bytes, measureFootprint(d, { code: ['src/decode.ts'], data: [] }).code_bytes);
});
