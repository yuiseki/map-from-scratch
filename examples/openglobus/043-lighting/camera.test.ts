import assert from 'node:assert/strict';
import test from 'node:test';
import { createSphereGrid, dragCamera, eyePosition, frontFacing, lonLatToUnit, project, viewProjection, zoomCamera } from './camera.ts';
import type { Camera } from './camera.ts';

const W = 1280, H = 800;
const screen = (cam: Camera, lon: number, lat: number): [number, number] => {
  const p = project(viewProjection(cam, W / H), lonLatToUnit(lon, lat), W, H);
  assert.ok(p, `lon ${lon} lat ${lat} projects in front of the camera`);
  return [p[0], p[1]];
};

test('lon/lat map to the unit sphere with lon 0 on +Z, 90E on +X and north on +Y', () => {
  const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
  assert.ok(close(lonLatToUnit(0, 0), [0, 0, 1]));
  assert.ok(close(lonLatToUnit(90, 0), [1, 0, 0]));
  assert.ok(close(lonLatToUnit(0, 90), [0, 1, 0]));
  assert.ok(close(lonLatToUnit(-180, 0), [0, 0, -1]));
});

test('the point the camera looks at lands in the middle of the screen', () => {
  const cam: Camera = { lon: 139.7, lat: 35.7, distance: 3 };
  const [x, y] = screen(cam, 139.7, 35.7);
  assert.ok(Math.abs(x - W / 2) < 1e-3 && Math.abs(y - H / 2) < 1e-3, `${x},${y}`);
});

test('east is to the right and north is up on screen', () => {
  const cam: Camera = { lon: 10, lat: 20, distance: 3 };
  const [cx, cy] = screen(cam, 10, 20);
  const [ex, ey] = screen(cam, 20, 20);
  const [nx, ny] = screen(cam, 10, 30);
  assert.ok(ex > cx + 20 && Math.abs(ey - cy) < 25, `east ${ex},${ey}`);
  assert.ok(ny < cy - 20 && Math.abs(nx - cx) < 1e-6, `north ${nx},${ny}`);
});

test('the globe fills a sensible part of the screen at the opening distance', () => {
  const cam: Camera = { lon: 0, lat: 0, distance: 3 };
  // The limb seen from distance d is at angle acos(1/d) from the sub-camera point.
  const limb = Math.acos(1 / cam.distance) * 180 / Math.PI;
  const [x] = screen(cam, limb - 0.01, 0);
  const radius = x - W / 2;
  assert.ok(radius > H * 0.3 && radius < H * 0.48, `globe radius ${radius}px`);
});

test('dragging right moves the surface right, dragging down moves it down', () => {
  const cam: Camera = { lon: 30, lat: 10, distance: 3 };
  const before = screen(cam, 30, 10);
  const right = screen(dragCamera(cam, 60, 0, H), 30, 10);
  const down = screen(dragCamera(cam, 0, 60, H), 30, 10);
  assert.ok(right[0] > before[0] + 30, `right drag: ${before[0]} -> ${right[0]}`);
  assert.ok(down[1] > before[1] + 30, `down drag: ${before[1]} -> ${down[1]}`);
});

test('a drag moves the point under the pointer by about the drag distance', () => {
  const cam: Camera = { lon: 0, lat: 0, distance: 3 };
  const moved = screen(dragCamera(cam, 40, 0, H), 0, 0);
  assert.ok(Math.abs(moved[0] - W / 2 - 40) < 6, `moved ${moved[0] - W / 2}px for a 40px drag`);
});

test('drag clamps latitude short of the poles and wraps longitude', () => {
  const up = dragCamera({ lon: 0, lat: 80, distance: 3 }, 0, 10000, H);
  assert.equal(up.lat, 85);
  const wrapped = dragCamera({ lon: -179, lat: 0, distance: 3 }, 10000, 0, H);
  assert.ok(wrapped.lon >= -180 && wrapped.lon < 180);
});

test('wheel zoom moves the camera closer, within limits, and changes the globe size', () => {
  const cam: Camera = { lon: 0, lat: 0, distance: 3 };
  const closer = zoomCamera(cam, -300);
  assert.ok(closer.distance < cam.distance);
  assert.equal(zoomCamera(cam, -1e6).distance, 1.35);
  assert.equal(zoomCamera(cam, 1e6).distance, 8);
  const edge = (c: Camera) => screen(c, 20, 0)[0] - W / 2;
  assert.ok(edge(closer) > edge(cam) + 10);
});

test('front-facing test separates the visible hemisphere from the far side', () => {
  const eye = eyePosition({ lon: 0, lat: 0, distance: 3 });
  assert.ok(frontFacing(lonLatToUnit(0, 0), eye));
  assert.ok(frontFacing(lonLatToUnit(60, 0), eye));
  assert.ok(!frontFacing(lonLatToUnit(80, 0), eye), 'beyond the limb at acos(1/3) = 70.5 deg');
  assert.ok(!frontFacing(lonLatToUnit(180, 0), eye));
});

test('sphere grid wraps longitude with duplicated seam vertices and faces outward', () => {
  const mesh = createSphereGrid(8, 16);
  assert.equal(mesh.positions.length, 9 * 17 * 3);
  assert.equal(mesh.indices.length, 8 * 16 * 6);
  const p = (i: number) => [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
  assert.ok(p(4 * 17).every((v, i) => Math.abs(v - p(4 * 17 + 16)[i]) < 1e-6), 'seam vertices coincide');
  assert.equal(mesh.uvs[4 * 17 * 2], 0);
  assert.equal(mesh.uvs[(4 * 17 + 16) * 2], 1);
  // u = (lon + 180) / 360, v = (90 - lat) / 180: the layout of the baked textures.
  const k = 2 * 17 + 4;
  const [x, y, z] = p(k);
  const lon = Math.atan2(x, z) * 180 / Math.PI, lat = Math.asin(y) * 180 / Math.PI;
  assert.ok(Math.abs(mesh.uvs[k * 2] - (lon + 180) / 360) < 1e-6);
  assert.ok(Math.abs(mesh.uvs[k * 2 + 1] - (90 - lat) / 180) < 1e-6);
  const t = (8 * 3 + 5) * 6;
  const [a, b, c] = [p(mesh.indices[t]), p(mesh.indices[t + 1]), p(mesh.indices[t + 2])];
  const ab = b.map((v, i) => v - a[i]), ac = c.map((v, i) => v - a[i]);
  const n = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
  assert.ok(n[0] * (a[0] + b[0] + c[0]) + n[1] * (a[1] + b[1] + c[1]) + n[2] * (a[2] + b[2] + c[2]) > 0);
});
