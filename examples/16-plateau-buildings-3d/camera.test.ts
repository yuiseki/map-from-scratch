import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boxDistance, boxVisible, eyeOf, farCorner, frame, lookAt, mul, ortho, perspective, planes, VIEWS } from './camera.ts';

test('orbit camera eye follows yaw, pitch and distance', () => {
  assert.deepEqual(eyeOf({ x: 1, y: 2, z: 3, yaw: 0, pitch: 0, dist: 10 }), [1, 12, 3]);
  const east = eyeOf({ x: 0, y: 0, z: 0, yaw: 90, pitch: 0, dist: 10 });
  assert.ok(Math.abs(east[0] - 10) < 1e-12);
  assert.ok(Math.abs(east[1]) < 1e-12);
  assert.ok(Math.abs(eyeOf(VIEWS.V2)[2] - VIEWS.V2.dist * Math.sin(VIEWS.V2.pitch * Math.PI / 180)) < 1e-10);
});

// A column-major matrix applied to a point (x, y, z, 1), as WebGL does.
const apply = (m: Float64Array, [x, y, z]: number[]): number[] =>
  [0, 1, 2, 3].map((r) => m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);

test('column-major matrices: mul(a, b) applies b first, then a', () => {
  const translate = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 20, 30, 1);
  const scale = Float64Array.of(2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 4, 0, 0, 0, 0, 1);
  // Scale (1, 1, 1) to (2, 3, 4), then move it: (12, 23, 34).
  assert.deepEqual(apply(mul(translate, scale), [1, 1, 1]), [12, 23, 34, 1]);
  // Move first, then scale: (11, 21, 31) to (22, 63, 124).
  assert.deepEqual(apply(mul(scale, translate), [1, 1, 1]), [22, 63, 124, 1]);
});

test('perspective puts the near and far planes at clip depth -1 and 1; ortho maps its box to the cube', () => {
  const p = perspective(Math.PI / 2, 2, 1, 100);
  const near = apply(p, [0, 0, -1]), far = apply(p, [0, 0, -100]);
  assert.ok(Math.abs(near[2] / near[3] + 1) < 1e-12);
  assert.ok(Math.abs(far[2] / far[3] - 1) < 1e-12);
  // 90 degrees vertically, aspect 2: at depth 1 the top is y 1, the right x 2.
  const corner = apply(p, [2, 1, -1]);
  assert.ok(Math.abs(corner[0] / corner[3] - 1) < 1e-12 && Math.abs(corner[1] / corner[3] - 1) < 1e-12);
  assert.deepEqual(apply(ortho(-1, 1, -2, 2, 1, 10), [1, -2, -1]), [1, -1, -1, 1]);
});

test('frustum classifies boxes and frame reports visible building indices', () => {
  const c = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, dist: 100 };
  const f = frame(c, 1, [
    { lo: [-20, -20, -10], hi: [20, 20, 10] },
    { lo: [-5, -5, -5], hi: [5, 5, 5] },
    { lo: [-5, 150, -5], hi: [5, 160, 5] },
  ]);
  assert.deepEqual(f.visible, [0]);
  assert.ok(f.near >= 1 && f.near <= 500);
  assert.ok(f.far >= f.near * 2);
  const view = lookAt([0, 100, 0], [0, 0, 0], [0, 0, 1]);
  const p = planes(mul(perspective(Math.PI / 4, 1, 0.5, 1e5), view));
  assert.equal(boxVisible(p, [-1, -1, -1], [1, 1, 1]), true);
  assert.equal(boxVisible(p, [-1, 150, -1], [1, 160, 1]), false);
  assert.equal(boxDistance([0, 0, 0], [-1, -1, -1], [1, 1, 1]), 0);
  assert.equal(farCorner([0, 0, 0], [-1, -2, -2], [1, 2, 2]), 3);
});
