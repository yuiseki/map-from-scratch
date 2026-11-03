import assert from 'node:assert/strict';
import test from 'node:test';
import { project, unproject, limbRadiusPx, type Camera } from './camera.ts';

const W = 1024, H = 768;
const near = (a: number, b: number, eps: number, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} ${a} vs ${b}`);

for (const t of [0, 1]) {
  const cam: Camera = { lon: 30, lat: 40, dist: 3, t };
  const view = t ? 'flat' : 'globe';

  test(`${view}: the centre of the view is the middle of the screen`, () => {
    const [x, y] = project(cam, W, H, 30, 40, 0);
    near(x, W / 2, 1e-6); near(y, H / 2, 1e-6);
  });

  test(`${view}: east is right and north is up`, () => {
    const [cx, cy] = project(cam, W, H, 30, 40, 0);
    const [ex, ey] = project(cam, W, H, 35, 40, 0);
    const [nx, ny] = project(cam, W, H, 30, 45, 0);
    assert.ok(ex > cx + 10, 'east right'); near(ey, cy, 3, 'east row');
    assert.ok(ny < cy - 10, 'north up'); near(nx, cx, 1e-6, 'north column');
  });

  test(`${view}: unproject inverts project on the surface`, () => {
    for (const [lon, lat] of [[10, 20], [55, 60], [30, 40], [0, 35]]) {
      const [x, y] = project(cam, W, H, lon, lat, 0);
      const g = unproject(cam, W, H, x, y)!;
      near(g[0], lon, 1e-6, 'lon'); near(g[1], lat, 1e-6, 'lat');
    }
  });

  test(`${view}: an extrusion moves its lid towards the eye`, () => {
    const a = project(cam, W, H, 30, 40, 0), b = project(cam, W, H, 30, 40, 0.1);
    assert.ok(b[2] < a[2], 'closer depth');
  });
}

test('globe: the limb radius is where the tangent point lands', () => {
  const cam: Camera = { lon: 0, lat: 0, dist: 3, t: 0 };
  // The tangent point seen from distance d is acos(1/d) from the centre.
  const a = Math.acos(1 / 3) * 180 / Math.PI;
  const [x] = project(cam, W, H, a, 0, 0);
  near(x - W / 2, limbRadiusPx(cam, H), 1e-6);
  assert.equal(unproject(cam, W, H, W / 2 + limbRadiusPx(cam, H) + 2, H / 2), null);
});

test('flat: the map reaches past the globe limb, so the outline changes', () => {
  const globe: Camera = { lon: 0, lat: 0, dist: 3, t: 0 };
  const flat: Camera = { ...globe, t: 1 };
  const x = W / 2 + limbRadiusPx(globe, H) * 1.2;
  assert.equal(unproject(globe, W, H, x, H / 2), null);
  assert.notEqual(unproject(flat, W, H, x, H / 2), null);
});
