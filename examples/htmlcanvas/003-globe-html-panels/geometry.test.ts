import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyCss, cameraEye, clipMatrix, cssTransform, drag, facing, panelModel, projectWorld, unitVector, zoom,
  type Camera,
} from './geometry.ts';

const near = (a: number, b: number, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} ${a} != ${b}`);
const VIEW = { width: 1280, height: 800 };
const cam = (lon: number, lat: number, distance = 3): Camera => ({ lon, lat, distance });

test('a place maps to the unit sphere with lon 0 on +Z and the north pole on +Y', () => {
  const p = unitVector(0, 0);
  near(p[0], 0); near(p[1], 0); near(p[2], 1);
  const e = unitVector(90, 0);
  near(e[0], 1); near(e[2], 0);
  const n = unitVector(-40, 90);
  near(n[1], 1);
});

test('the camera centre lon/lat projects to the screen centre', () => {
  for (const [lon, lat] of [[0, 0], [-20, 20], [139.7, 35.7], [-46.6, -23.6]]) {
    const m = clipMatrix(cam(lon, lat), VIEW.width / VIEW.height);
    const s = projectWorld(m, unitVector(lon, lat), VIEW.width, VIEW.height)!;
    near(s[0], 640, 1e-6, `x for ${lon},${lat}`);
    near(s[1], 400, 1e-6, `y for ${lon},${lat}`);
  }
});

test('north is up and east is right on screen', () => {
  const m = clipMatrix(cam(10, 0), VIEW.width / VIEW.height);
  const c = projectWorld(m, unitVector(10, 0), 1280, 800)!;
  const north = projectWorld(m, unitVector(10, 20), 1280, 800)!;
  const east = projectWorld(m, unitVector(30, 0), 1280, 800)!;
  assert.ok(north[1] < c[1] - 50, `north ${north} centre ${c}`);
  near(north[0], c[0], 1e-6);
  assert.ok(east[0] > c[0] + 50, `east ${east} centre ${c}`);
});

test('moving closer makes the globe larger on screen', () => {
  const far = projectWorld(clipMatrix(cam(0, 0, 5), 1.6), unitVector(20, 0), 1280, 800)!;
  const close = projectWorld(clipMatrix(cam(0, 0, 2.5), 1.6), unitVector(20, 0), 1280, 800)!;
  assert.ok(close[0] - 640 > 1.5 * (far[0] - 640), `${close} vs ${far}`);
});

test('a point behind the camera does not project', () => {
  const m = clipMatrix(cam(0, 0, 3), 1.6);
  assert.equal(projectWorld(m, [0, 0, 4], 1280, 800), null);
});

test('the far side of the globe faces away and the near side faces the camera', () => {
  const c = cam(0, 0, 3);
  assert.ok(facing(c, 0, 0) > 0.99);
  assert.ok(facing(c, 180, 0) < 0);
  assert.ok(facing(c, 0, 89) < facing(c, 0, 30));
  // On the horizon seen from distance 3 the cosine is ~0.33 at 70.5 degrees.
  assert.ok(facing(c, 69, 0) > 0, 'just inside the horizon');
  assert.ok(facing(c, 72, 0) < 0, 'just beyond the horizon');
});

test('the camera eye sits on the axis through the centre place', () => {
  const e = cameraEye(cam(-20, 20, 4));
  const u = unitVector(-20, 20);
  for (let i = 0; i < 3; i++) near(e[i], 4 * u[i]);
});

test('the panel CSS box maps its four corners onto the four projected quad corners', () => {
  const c = cam(-20, 20, 3);
  const m = clipMatrix(c, VIEW.width / VIEW.height);
  const w = 232, h = 160, s = 1 / 450;
  const model = panelModel(-0.1, 51.5, w, h, s);
  const t = cssTransform(m, model, VIEW.width, VIEW.height);
  for (const [x, y] of [[0, 0], [w, 0], [w, h], [0, h], [w / 2, h / 2]]) {
    const world = model.at(x, y);
    const expected = projectWorld(m, world, VIEW.width, VIEW.height)!;
    const got = applyCss(t, x, y);
    near(got[0], expected[0], 1e-6, `x of corner ${x},${y}`);
    near(got[1], expected[1], 1e-6, `y of corner ${x},${y}`);
  }
});

test('the bottom centre of the panel box is the place itself, and the box stands to its north', () => {
  const model = panelModel(3.39, 6.45, 232, 160, 1 / 450);
  const anchor = model.at(116, 160);
  const p = unitVector(3.39, 6.45);
  for (let i = 0; i < 3; i++) near(anchor[i], p[i] * model.lift, 1e-9);
  const top = model.at(116, 0);
  // The top edge is further north (larger y) than the anchor, and still above the sphere.
  assert.ok(top[1] > anchor[1]);
  assert.ok(Math.hypot(...top) > 1);
  // The box is a rectangle of w*s by h*s in world units.
  const tl = model.at(0, 0), tr = model.at(232, 0), bl = model.at(0, 160);
  near(Math.hypot(tr[0] - tl[0], tr[1] - tl[1], tr[2] - tl[2]), 232 / 450, 1e-9);
  near(Math.hypot(bl[0] - tl[0], bl[1] - tl[1], bl[2] - tl[2]), 160 / 450, 1e-9);
});

test('the CSS transform is a projective map: the z row passes z through so it can be inverted', () => {
  const m = clipMatrix(cam(0, 0, 3), 1.6);
  const t = cssTransform(m, panelModel(0, 0, 100, 50, 1 / 450), 1280, 800);
  // Column-major as DOMMatrix(init): m13 m23 m33 m43 are t[2], t[6], t[10], t[14].
  assert.deepEqual([t[2], t[6], t[10], t[14]], [0, 0, 1, 0]);
  assert.deepEqual([t[8], t[9], t[11]], [0, 0, 0]);
});

test('dragging right moves the surface right, dragging down moves it down, latitude is clamped', () => {
  const c = cam(0, 0, 3);
  const r = drag(c, 100, 0, 800);
  assert.ok(r.lon < 0, `dragging right lowers the centre longitude: ${r.lon}`);
  const d = drag(c, 0, 100, 800);
  assert.ok(d.lat > 0, `dragging down raises the centre latitude: ${d.lat}`);
  assert.ok(drag(c, 0, 1e6, 800).lat <= 80);
  // The point under the pointer follows it: a 40 px drag moves the centre place ~40 px.
  const m0 = clipMatrix(c, 1.6);
  const moved = drag(c, 40, 0, 800);
  const m1 = clipMatrix(moved, 1.6);
  const before = projectWorld(m0, unitVector(0, 0), 1280, 800)!;
  const after = projectWorld(m1, unitVector(0, 0), 1280, 800)!;
  near(after[0] - before[0], 40, 2);
});

test('wheel zoom is clamped to the allowed distances', () => {
  assert.ok(zoom(3, -100) < 3);
  assert.ok(zoom(3, 100) > 3);
  assert.equal(zoom(3, -1e6), 2.2);
  assert.equal(zoom(3, 1e6), 6);
});
