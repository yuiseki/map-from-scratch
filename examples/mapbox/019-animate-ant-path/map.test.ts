import assert from 'node:assert/strict';
import test from 'node:test';
import { advanceAntDash } from './map.ts';

test('marching-ant dash offset moves backwards by the configured frame speed', () => {
  assert.equal(advanceAntDash(0), -0.6);
  assert.equal(advanceAntDash(-0.6), -1.2);
});

test('marching-ant dash offset repeats after one dash plus gap period', () => {
  assert.ok(Math.abs(advanceAntDash(-20) - advanceAntDash(0)) < 1e-12);
});
