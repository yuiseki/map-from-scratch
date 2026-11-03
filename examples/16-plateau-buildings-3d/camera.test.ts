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

test('column-major matrix multiplication has identity and transforms the view', () => {
  const identity = Float64Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1);
  const projection = perspective(Math.PI / 2, 2, 1, 100);
  assert.deepEqual(mul(identity, projection), projection);
  assert.deepEqual(mul(projection, identity), projection);
  assert.equal(ortho(-1, 1, -1, 1, 1, 10).length, 16);
  assert.equal(planes(projection).length, 24);
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
