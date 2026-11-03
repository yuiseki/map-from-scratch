import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewOf, project, orbitDrag, panDrag, wheelZoom, frustumPlanes, boxVisible, distanceToBox, type Orbit } from './camera.ts';

const W = 1280, H = 800;
const base = (): Orbit => ({ tx: 0, ty: 0, tz: 0, heading: 0, pitch: 35, distance: 500 });

test('the target is at the centre of the screen and the sky is up', () => {
  const v = viewOf(base(), W, H);
  const [x, y] = project(v, [0, 0, 0], W, H);
  assert.ok(Math.abs(x - W / 2) < 1e-6 && Math.abs(y - H / 2) < 1e-6);
  assert.ok(v.up[2] > 0, 'up has a positive height component');
  assert.ok(v.eye[2] > 0, 'the eye is above the target');
  const [, yHigh] = project(v, [0, 0, 100], W, H);
  assert.ok(yHigh < H / 2, 'a point above the target is drawn higher on screen');
});

test('heading 0 looks north: east is right, north is farther up the screen', () => {
  const v = viewOf(base(), W, H);
  assert.ok(project(v, [100, 0, 0], W, H)[0] > W / 2);
  assert.ok(project(v, [0, 100, 0], W, H)[1] < H / 2);
  // heading 90 looks east: north is now on the left.
  const e = viewOf({ ...base(), heading: 90 }, W, H);
  assert.ok(project(e, [0, 100, 0], W, H)[0] < W / 2);
});

test('dragging right and down moves the content right and down', () => {
  const o = base(), p: [number, number, number] = [0, -150, 0]; // in front of the target
  const before = project(viewOf(o, W, H), p, W, H);
  panDrag(o, 40, 30, H);
  const after = project(viewOf(o, W, H), p, W, H);
  assert.ok(after[0] > before[0] + 10, `x ${before[0]} -> ${after[0]}`);
  assert.ok(after[1] > before[1] + 10, `y ${before[1]} -> ${after[1]}`);
});

test('orbit drag to the right swings the near side of the scene to the right', () => {
  const o = base(), p: [number, number, number] = [0, -150, 0];
  const before = project(viewOf(o, W, H), p, W, H);
  orbitDrag(o, 40, 0);
  assert.ok(project(viewOf(o, W, H), p, W, H)[0] > before[0] + 5);
  orbitDrag(o, 0, -10000);
  assert.ok(o.pitch >= 5 && o.pitch <= 90, `pitch ${o.pitch} clamped`);
});

test('wheel down zooms out, wheel up zooms in, within limits', () => {
  const o = base();
  wheelZoom(o, 100); assert.ok(o.distance > 500);
  wheelZoom(o, -400); assert.ok(o.distance < 500);
  wheelZoom(o, -1e6); assert.ok(o.distance >= 30);
});

test('frustum culling keeps boxes in view and drops boxes behind the camera', () => {
  const v = viewOf(base(), W, H), planes = frustumPlanes(v.viewProj);
  assert.ok(boxVisible(planes, [-10, -10, 0], [10, 10, 10]));
  // Far behind the eye (the eye is south of the target looking north).
  assert.ok(!boxVisible(planes, [-10, -5000, 0], [10, -4900, 10]));
  // Far to the east, outside the side planes.
  assert.ok(!boxVisible(planes, [5000, -10, 0], [5100, 10, 10]));
});

test('distance to a box is 0 inside it and the gap to its nearest face outside', () => {
  assert.equal(distanceToBox([5, 5, 5], [0, 0, 0], [10, 10, 10]), 0);
  assert.equal(distanceToBox([13, 5, 14], [0, 0, 0], [10, 10, 10]), 5);
});

test('the opening view stands over the baked square, so the data fills most of the screen', async () => {
  const { HOME } = await import('./camera.ts');
  // The four z16 roots of bake.ts: x -409..584 m, y -635..320 m from Tokyo Station.
  const v = viewOf(HOME, W, H);
  assert.ok(v.eye[0] > -409 && v.eye[0] < 584 && v.eye[1] > -635 && v.eye[1] < 320, `eye ${v.eye.map(Math.round)}`);
  // Count a grid of screen samples whose ray meets street level inside the square.
  let inside = 0, total = 0;
  for (let sy = 5; sy < H; sy += 10) for (let sx = 5; sx < W; sx += 10) {
    total++;
    const t = Math.tan(v.fovy / 2), nx = (2 * sx / W - 1) * t * W / H, ny = (1 - 2 * sy / H) * t;
    const d = [0, 1, 2].map((a) => v.forward[a] + nx * v.right[a] + ny * v.up[a]);
    if (d[2] >= 0) continue;
    const k = (5 - v.eye[2]) / d[2], x = v.eye[0] + k * d[0], y = v.eye[1] + k * d[1];
    if (x > -409 && x < 584 && y > -635 && y < 320) inside++;
  }
  assert.ok(inside / total >= 0.6, `${(100 * inside / total).toFixed(1)}% of the screen over the data`);
});
