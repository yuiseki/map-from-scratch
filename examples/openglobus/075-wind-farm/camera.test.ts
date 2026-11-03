import assert from 'node:assert/strict';
import test from 'node:test';
import { orbitCamera, project, orbitDrag, zoomDistance, MIN_PITCH, MAX_PITCH } from './camera.ts';

const W = 1280, H = 800;
const cam = { target: [1000, 2000, 50] as [number, number, number], heading: 30, pitch: 10, distance: 5000 };

test('the orbit target projects to the centre of the screen', () => {
  const c = orbitCamera(cam, W / H);
  const p = project(c.viewProj, cam.target, W, H)!;
  assert.ok(Math.abs(p[0] - W / 2) < 1e-3 && Math.abs(p[1] - H / 2) < 1e-3, String(p));
});

test('up is up: a point above the target appears higher on the screen (sky at the top)', () => {
  const c = orbitCamera(cam, W / H);
  const p = project(c.viewProj, [1000, 2000, 450], W, H)!;
  assert.ok(p[1] < H / 2 - 10, `y ${p[1]}`);
  assert.ok(c.eye[2] > cam.target[2], 'eye above the target when pitched down');
});

test('heading 0 looks north: east is to the right, the far side is higher on screen', () => {
  const c = orbitCamera({ ...cam, heading: 0 }, W / H);
  const east = project(c.viewProj, [1500, 2000, 50], W, H)!;
  assert.ok(east[0] > W / 2 + 10, `east x ${east[0]}`);
  assert.ok(c.eye[1] < cam.target[1], 'eye south of the target');
  const north = project(c.viewProj, [1000, 4000, 50], W, H)!;
  assert.ok(north[1] < H / 2, 'the far ground sits above the target on screen');
});

test('points behind the eye do not project', () => {
  const c = orbitCamera({ ...cam, heading: 0 }, W / H);
  assert.equal(project(c.viewProj, [1000, -20000, 50], W, H), null);
});

test('dragging right turns the view, dragging down tilts towards the ground, within limits', () => {
  const a = orbitDrag(cam, 100, 0);
  assert.ok(a.heading !== cam.heading);
  const b = orbitDrag(cam, 0, 1e5);
  assert.equal(b.pitch, MAX_PITCH);
  const c = orbitDrag(cam, 0, -1e5);
  assert.equal(c.pitch, MIN_PITCH);
  assert.ok(MIN_PITCH > 0, 'the eye never goes below the target');
});

test('wheel zoom is multiplicative and clamped', () => {
  assert.ok(zoomDistance(5000, -100) < 5000);
  assert.ok(zoomDistance(5000, 100) > 5000);
  assert.equal(zoomDistance(5000, -1e6), zoomDistance(1, 0));
  assert.equal(zoomDistance(5000, 1e6), zoomDistance(1e9, 0));
});
