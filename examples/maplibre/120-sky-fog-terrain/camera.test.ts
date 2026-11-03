import test from 'node:test';
import assert from 'node:assert/strict';
import { eyeOf, viewProj, project, horizonY, drag, zoom, clampCamera, FOV_Y, type Cam } from './camera.ts';

const cam: Cam = { tx: 0, ty: 0, tz: 1000, bearing: 0, pitch: 77, distance: 20000 };
const W = 1280, H = 800;

test('bearing 0 looks north: the eye stands south of the target, above it', () => {
  const e = eyeOf(cam);
  assert.ok(Math.abs(e[0]) < 1e-6);
  assert.ok(e[1] < -19000);
  assert.ok(e[2] > cam.tz);
});

test('the sky is at the top: a point far ahead and high projects above one far ahead on the ground', () => {
  const m = viewProj(cam, W / H);
  const ground = project(m, [0, 100000, 0], W, H)!;
  const air = project(m, [0, 100000, 20000], W, H)!;
  assert.ok(air[1] < ground[1], `air ${air[1]} ground ${ground[1]}`);
  // north is ahead: a point further north is higher on the screen
  const nearer = project(m, [0, 5000, 1000], W, H)!;
  assert.ok(ground[1] < nearer[1]);
  // east is to the right when looking north
  const east = project(m, [5000, 30000, 1000], W, H)!;
  assert.ok(east[0] > W / 2);
});

test('horizonY is where a far point at eye height lands on the screen', () => {
  for (const pitch of [60, 77, 80]) {
    const c = { ...cam, pitch };
    const e = eyeOf(c);
    const m = viewProj(c, W / H);
    const far = project(m, [0, e[1] + 1e7, e[2]], W, H)!;
    assert.ok(Math.abs(far[1] - horizonY(pitch, H)) < 0.5, `pitch ${pitch}: ${far[1]} vs ${horizonY(pitch, H)}`);
  }
  // at pitch 77 with MapLibre's field of view the horizon is in the top fifth
  const y = horizonY(77, H);
  assert.ok(y > 0.1 * H && y < 0.2 * H, String(y));
  assert.ok(FOV_Y > 0.6 && FOV_Y < 0.7);
});

test('dragging right moves the ground in front of the camera to the right; dragging down lowers the pitch', () => {
  const m0 = viewProj(cam, W / H);
  const p = [0, -8000, 1000];      // ground between eye and target
  const before = project(m0, p, W, H)!;
  const turned = drag(cam, 40, 0);
  const after = project(viewProj(turned, W / H), p, W, H)!;
  assert.ok(after[0] > before[0] + 5, `${before[0]} -> ${after[0]}`);
  assert.ok(drag(cam, 0, 40).pitch < cam.pitch);
  assert.ok(drag({ ...cam, pitch: 84 }, 0, -400).pitch <= 85);
});

test('wheel zoom changes the distance within limits', () => {
  assert.ok(zoom(cam, -100).distance < cam.distance);
  assert.ok(zoom(cam, 100).distance > cam.distance);
  assert.ok(zoom(cam, -1e6).distance >= 800);
  assert.ok(zoom(cam, 1e6).distance <= 80000);
});

test('the camera is lifted out of the ground: lower pitch until the eye clears the terrain', () => {
  // a wall 3,000 m high everywhere south of the target
  const ground = (_x: number, y: number) => (y < -1000 ? 3000 : 1000);
  const low = { ...cam, distance: 5000, pitch: 80 };       // eye ~ 1868 m: inside the wall
  assert.ok(eyeOf(low)[2] < 3000);
  const c = clampCamera(low, ground);
  assert.ok(eyeOf(c)[2] >= 3000 + 150 - 1e-6, String(eyeOf(c)[2]));
  assert.ok(c.pitch < low.pitch);
  // a camera already clear is left alone
  assert.deepEqual(clampCamera(cam, () => 0), cam);
});
