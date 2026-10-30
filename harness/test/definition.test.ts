import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDefinition, fromDefinition, publishOnPages } from '../lib/spec.ts';

// Loose on purpose: the tests break definitions to see them refused.
const def = (): any => ({
  id: '01-x',
  request: 'X をしたいから地図作って',
  requirements: [
    { id: 'light', need: '軽い' },
    { id: 'smooth', need: '滑らか' },
  ],
  evaluation: {
    budgets: [
      { metric: 'code_gzip_bytes', max: 1500, requirement: 'light' },
      { metric: 'frame_ms', stat: 'p95', max: 8.3, requirement: 'smooth' },
    ],
  },
  benchmarks: {
    runtime: 'browser',
    page: 'examples/01-x/index.html',
    viewport: { width: 390, height: 844, device_scale_factor: 3, mobile: true },
    cpu_throttle: 4,
    iterations: 3,
    scenarios: [{ id: 'path', what: 'zoom in and out', metrics: ['frame_ms'] }],
  },
  datasets: {
    bake: ['node', 'examples/01-x/bake.mjs'],
    sources: [{ id: 'ne', origin: 'Natural Earth', license: 'Public domain' }],
    outputs: ['data/baked/01-x/a.bin'],
  },
  performance_knowledge: [{ id: 'k', finding: 'f', evidence: 'e' }],
  architecture_selection: {
    chosen: { platform: 'browser', api: 'WebGL2', language: 'JavaScript', gpu: 'hardware', code: ['examples/01-x/map.js'] },
    alternatives: [{ option: 'Canvas 2D', rejected_because: 'too slow' }],
    not_doing: ['3D'],
  },
  verification: {
    checks: [{ id: 'pick-tokyo', what: 'Tokyo picks JPN', how: 'pick at Tokyo', expected: 'JPN' }],
  },
});

test('a complete definition is valid', () => {
  assert.doesNotThrow(() => validateDefinition(def(), '01-x'));
});

test('Pages publication defaults to enabled and can be explicitly disabled with a reason', () => {
  const d = def();
  assert.equal(publishOnPages(validateDefinition(d, '01-x')), true);
  d.publication = { pages: false, reason: 'Source data redistribution has not been cleared' };
  assert.equal(publishOnPages(validateDefinition(d, '01-x')), false);
  delete d.publication.reason;
  assert.throws(() => validateDefinition(d, '01-x'), /publication.reason/);
});

test('every one of the seven sections is required', () => {
  for (const k of ['requirements', 'evaluation', 'benchmarks', 'datasets', 'performance_knowledge', 'architecture_selection', 'verification']) {
    const d = def();
    delete d[k];
    assert.throws(() => validateDefinition(d, '01-x'), new RegExp(k));
  }
});

test('a budget must point at a requirement that exists', () => {
  const d = def();
  d.evaluation.budgets[0].requirement = 'nope';
  assert.throws(() => validateDefinition(d, '01-x'), /nope/);
});

test('a requirement needs a budget, or says why it is not measured', () => {
  const d = def();
  d.requirements.push({ id: 'pretty', need: 'きれい' });
  assert.throws(() => validateDefinition(d, '01-x'), /pretty/);
  d.requirements[2].unmeasured = '目視で確かめる';
  assert.doesNotThrow(() => validateDefinition(d, '01-x'));
});

test('a check needs what, how and expected', () => {
  const d = def();
  delete d.verification.checks[0].how;
  assert.throws(() => validateDefinition(d, '01-x'), /pick-tokyo/);
});

test('fromDefinition gives the harness its run settings', () => {
  const s = fromDefinition(def());
  assert.equal(s.runtime, 'browser');
  assert.equal(s.gpu, 'hardware');
  assert.deepEqual(s.bake, ['node', 'examples/01-x/bake.mjs']);
  assert.deepEqual(s.run, { page: 'examples/01-x/index.html', viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true }, cpuThrottle: 4 });
  assert.equal(s.iterations, 3);
  assert.deepEqual(s.footprint, { code: ['examples/01-x/map.js'], data: ['data/baked/01-x/a.bin'], elf: undefined });
  assert.deepEqual(s.budgets, { code_gzip_bytes: { stat: undefined, max: 1500, min: undefined }, frame_ms: { stat: 'p95', max: 8.3, min: undefined } });
  assert.deepEqual(s.checks, ['pick-tokyo']);
});

test('checks done at build time are not expected from the bench', () => {
  const d = def();
  d.verification.checks.push({ id: 'freestanding', what: 'w', how: 'h', expected: 'e', by: 'build' });
  assert.deepEqual(fromDefinition(d).checks, ['pick-tokyo']);
});

test('a native definition runs a command', () => {
  const d = def();
  d.benchmarks = { runtime: 'native', cmd: ['build/x', '--bench'], iterations: 5, scenarios: [] };
  assert.deepEqual(fromDefinition(d).run, { cmd: ['build/x', '--bench'] });
});

test('benchmarks.network becomes the emulated network of the run', () => {
  const d = def();
  d.benchmarks.network = { name: '4G', latency_ms: 60, download_mbps: 9 };
  assert.deepEqual(fromDefinition(d).run.network, { name: '4G', latencyMs: 60, downloadKbps: 9000, uploadKbps: 9000 });
  assert.equal(fromDefinition(def()).run.network, undefined);
});

test('chosen.toolchain names the image the build needs', () => {
  const d = def();
  d.architecture_selection.chosen.toolchain = 'emscripten';
  assert.equal(fromDefinition(d).toolchain, 'emscripten');
  assert.equal(fromDefinition(def()).toolchain, undefined);
});
