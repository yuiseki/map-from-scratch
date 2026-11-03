import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lookAt, perspective, mul, viewOf, project, nearFar } from './camera.ts';
import type { Basis } from './geo.ts';

const near = (a: number, b: number, eps: number, what = '') => assert.ok(Math.abs(a - b) <= eps, `${what} ${a} vs ${b}`);

test('a point straight ahead lands in the middle of the screen; right is right and up is up', () => {
  const b: Basis = { right: [1, 0, 0], up: [0, 0, 1], fwd: [0, 1, 0] };
  const vp = mul(perspective(45, 1280 / 800, 1, 1000), viewOf(b));
  const c = project(vp, [0, 100, 0], 1280, 800)!;
  near(c[0], 640, 1e-9); near(c[1], 400, 1e-9);
  const r = project(vp, [10, 100, 0], 1280, 800)!, u = project(vp, [0, 100, 10], 1280, 800)!;
  assert.ok(r[0] > 640 && Math.abs(r[1] - 400) < 1e-9, `right ${r}`);
  assert.ok(u[1] < 400 && Math.abs(u[0] - 640) < 1e-9, `up (screen y grows down) ${u}`);
  // Half the vertical field of view reaches the top edge.
  const top = project(vp, [0, 100, 100 * Math.tan(22.5 * Math.PI / 180)], 1280, 800)!;
  near(top[1], 0, 1e-6);
  assert.equal(project(vp, [0, -100, 0], 1280, 800), null, 'behind the camera');
});

test('lookAt agrees with viewOf for the same basis', () => {
  const a = lookAt([0, 0, 0], [0, 1, 0], [0, 0, 1]);
  const b = viewOf({ right: [1, 0, 0], up: [0, 0, 1], fwd: [0, 1, 0] });
  for (let i = 0; i < 16; i++) near(a[i], b[i], 1e-12, `m[${i}]`);
});

test('near and far planes scale with the altitude and reach past the horizon', () => {
  const R = 6371000;
  for (const h of [50, 300, 2000, 120000, 2e7]) {
    const [n, f] = nearFar(h, R);
    const horizon = Math.sqrt(h * (2 * R + h));
    assert.ok(n >= 0.5 && n <= Math.max(1, h * 0.1), `near ${n} at ${h}`);
    assert.ok(f > horizon && f / n < 2e5, `far ${f} at ${h} (horizon ${horizon})`);
  }
});
