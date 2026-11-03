import assert from 'node:assert/strict';
import test from 'node:test';
import { morphProjection } from './projection.ts';

test('projection transition preserves endpoints and interpolates coordinates', () => {
  const a = morphProjection([0.25, 0.4], [0.75, 0.8], 0);
  const b = morphProjection([0.25, 0.4], [0.75, 0.8], 1);
  const m = morphProjection([0.25, 0.4], [0.75, 0.8], 0.5);
  assert.deepEqual(a, [0.25, 0.4]);
  assert.deepEqual(b, [0.75, 0.8]);
  assert.ok(Math.abs(m[0] - 0.5) < 1e-12 && Math.abs(m[1] - 0.6) < 1e-12);
});

test('orthographic screen center faces the equator and top edge faces north', async () => {
  const { orthographicDirection } = await import('./projection.ts');
  const center = orthographicDirection(0, 0);
  const north = orthographicDirection(0, 1);
  assert.ok(Math.abs(center[0] - 1) < 1e-12 && Math.abs(center[1]) < 1e-12 && Math.abs(center[2]) < 1e-12);
  assert.ok(Math.abs(north[0]) < 1e-12 && Math.abs(north[1]) < 1e-12 && Math.abs(north[2] - 1) < 1e-12);
});
