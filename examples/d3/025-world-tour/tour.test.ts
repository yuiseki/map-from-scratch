import assert from 'node:assert/strict';
import test from 'node:test';
import { greatCirclePoint } from './tour.ts';

test('great circle route reaches both endpoints and stays on the unit sphere', () => {
  const a = greatCirclePoint([0, 0], [90, 0], 0);
  const mid = greatCirclePoint([0, 0], [90, 0], 0.5);
  const b = greatCirclePoint([0, 0], [90, 0], 1);
  assert.ok(Math.abs(a[0] - 1) < 1e-9 && Math.abs(a[1]) < 1e-9 && Math.abs(a[2]) < 1e-9);
  assert.ok(Math.abs(mid[0] - Math.SQRT1_2) < 1e-6 && Math.abs(mid[1] - Math.SQRT1_2) < 1e-6);
  assert.ok(Math.abs(b[0]) < 1e-6 && Math.abs(b[1] - 1) < 1e-6);
});

test('tour camera centers the requested geographic point', async () => {
  const { rotateByQuaternion, viewQuaternion } = await import('./tour.ts');
  const q = viewQuaternion(139.69, 35.68);
  const lon = 139.69 * Math.PI / 180, lat = 35.68 * Math.PI / 180;
  const city: [number, number, number] = [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  const centered = rotateByQuaternion(q, city);
  assert.ok(Math.abs(centered[0] - 1) < 1e-6 && Math.abs(centered[1]) < 1e-6 && Math.abs(centered[2]) < 1e-6);
});
