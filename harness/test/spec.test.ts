import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSpec, missingToolchain } from '../lib/spec.ts';

// Loose on purpose: the tests break specs to see them refused.
const browser: Record<string, any> = {
  id: '01-x',
  request: 'X をしたいから地図作って',
  runtime: 'browser',
  run: { page: 'examples/01-x/index.html' },
  budgets: { frame_ms: { stat: 'p95', max: 8 } },
  footprint: { code: ['examples/01-x/main.js'] },
};

test('a minimal browser spec is valid and gets defaults', () => {
  const s = validateSpec(structuredClone(browser), '01-x');
  assert.equal(s.iterations, 5);
  assert.deepEqual(s.run.viewport, { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
});

test('a native spec needs run.cmd', () => {
  const s = { ...structuredClone(browser), runtime: 'native', run: {} };
  assert.throws(() => validateSpec(s, '01-x'), /run.cmd/);
});

test('id must match the directory name', () => {
  assert.throws(() => validateSpec(structuredClone(browser), '02-y'), /id/);
});

test('unknown runtime is rejected', () => {
  assert.throws(() => validateSpec({ ...structuredClone(browser), runtime: 'flash' }, '01-x'), /runtime/);
});

test('a budget with neither max nor min is rejected', () => {
  const s = structuredClone(browser);
  s.budgets.frame_ms = { stat: 'p95' };
  assert.throws(() => validateSpec(s, '01-x'), /max or min/);
});

test('the request text is required: it is the point of the example', () => {
  const s = structuredClone(browser);
  delete s.request;
  assert.throws(() => validateSpec(s, '01-x'), /request/);
});

test('footprint.code is required: shipping cost is part of every request', () => {
  const s = structuredClone(browser);
  delete s.footprint;
  assert.throws(() => validateSpec(s, '01-x'), /footprint/);
});

test('gpu defaults to hardware, dependencies to none', () => {
  const s = validateSpec(structuredClone(browser), '01-x');
  assert.equal(s.gpu, 'hardware');
  assert.deepEqual(s.dependencies, []);
  assert.throws(() => validateSpec({ ...structuredClone(browser), gpu: 'maybe' }, '01-x'), /gpu/);
});

test('a microcontroller spec may give footprint.elf instead of code', () => {
  const s = structuredClone(browser);
  s.footprint = { elf: ['build/x.o'] };
  assert.deepEqual(validateSpec(s, '01-x').footprint.code, []);
});

test('a toolchain must name a docker/Dockerfile.<name> image', () => {
  assert.equal(validateSpec({ ...structuredClone(browser), toolchain: 'emscripten' }, '01-x').toolchain, 'emscripten');
  assert.throws(() => validateSpec({ ...structuredClone(browser), toolchain: '../base' }, '01-x'), /toolchain/);
});

test('a build that needs a toolchain says how to get it, unless the image has it', () => {
  const s = validateSpec({ ...structuredClone(browser), toolchain: 'emscripten' }, '01-x');
  assert.match(missingToolchain(s, undefined)!, /MFS_TOOLCHAIN=emscripten bin\/mfs build 01-x/);
  assert.match(missingToolchain(s, 'other')!, /emscripten/);
  assert.equal(missingToolchain(s, 'emscripten'), null);
  assert.equal(missingToolchain(validateSpec(structuredClone(browser), '01-x'), undefined), null);
});
