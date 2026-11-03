import test from 'node:test';
import assert from 'node:assert/strict';
import { frame, project, unproject, limbPx, atmosphereBlend, metresPerPixel, ecef, EARTH_R, type View } from './camera.ts';

const base: View = { lon: 140.4, lat: 39.7, zoom: 9, pitch: 0, bearing: 0, centerH: 0, width: 1280, height: 800 };
const at = (v: View, lon: number, lat: number, h = 0) => project(frame(v), lon, lat, h)!;
const near = (a: number, b: number, tol: number, msg = '') => assert.ok(Math.abs(a - b) <= tol, `${msg} ${a} vs ${b}`);

test('the centre of the view projects to the centre of the screen at any pitch and bearing', () => {
  for (const pitch of [0, 45, 70]) for (const bearing of [0, 57, -120]) {
    const v = { ...base, pitch, bearing, centerH: 300 };
    const [x, y] = at(v, v.lon, v.lat, 300);
    near(x, 640, 1e-6, `x p${pitch} b${bearing}`);
    near(y, 400, 1e-6, `y p${pitch} b${bearing}`);
  }
});

test('north is up and east is right at bearing 0; east is up at bearing 90', () => {
  const [nx, ny] = at(base, base.lon, base.lat + 0.05);
  assert.ok(ny < 400 - 10 && Math.abs(nx - 640) < 1, 'north above the centre');
  const [ex, ey] = at(base, base.lon + 0.05, base.lat);
  assert.ok(ex > 640 + 10 && Math.abs(ey - 400) < 1, 'east right of the centre');
  const [x90, y90] = at({ ...base, bearing: 90 }, base.lon + 0.05, base.lat);
  assert.ok(y90 < 400 - 10 && Math.abs(x90 - 640) < 1, 'looking east, east is up');
});

test('pitched, the ground far ahead is above the centre and the sky is at the top', () => {
  const v = { ...base, pitch: 70 };
  const [, yFar] = at(v, base.lon, base.lat + 0.3);
  const [, yNear] = at(v, base.lon, base.lat - 0.05);
  assert.ok(yFar < 400 && yNear > 400, `far ${yFar}, near ${yNear}`);
  const f = frame(v);
  const up = ecef(base.lon, base.lat, 0).map((c) => c / EARTH_R);
  assert.ok(f.up[0] * up[0] + f.up[1] * up[1] + f.up[2] * up[2] > 0, 'camera up points away from the ground');
});

test('one zoom step doubles screen distances near the centre (the globe matches the map scale)', () => {
  const d = (z: number) => { const [x, y] = at({ ...base, zoom: z }, base.lon + 0.01, base.lat); return Math.hypot(x - 640, y - 400); };
  near(d(10) / d(9), 2, 0.01);
  near(d(5) / d(4), 2, 0.02);
  // MapLibre's scale: at the centre, 1 degree of longitude is 512 * 2^zoom / 360 px.
  near(d(9), (0.01 / 360) * 512 * 2 ** 9, d(9) * 0.01, 'mercator scale at the centre');
  // metresPerPixel is the scale at the centre that this implies.
  const px = d(9), m = 0.01 * (Math.PI / 180) * EARTH_R * Math.cos((base.lat * Math.PI) / 180);
  near(m / px, metresPerPixel(9, base.lat), metresPerPixel(9, base.lat) * 0.01);
});

test('a raised point appears higher on screen than the same place at sea level when pitched', () => {
  const v = { ...base, pitch: 70, zoom: 11 };
  const [x0, y0] = at(v, base.lon + 0.01, base.lat + 0.01, 0);
  const [x1, y1] = at(v, base.lon + 0.01, base.lat + 0.01, 400);
  // Near the centre a height h moves a point up by about h sin(pitch) / (m per px).
  const expected = (400 * Math.sin((70 * Math.PI) / 180)) / metresPerPixel(11, base.lat);
  near(y0 - y1, expected, expected * 0.15, 'shift');
  near(x0, x1, Math.abs(y0 - y1) * 0.5);
});

test('limbPx is the distance of the horizon of the sphere from the screen centre (pitch 0)', () => {
  const v = { ...base, zoom: 1.5 };
  const f = frame(v);
  const dist = Math.hypot(...f.eye);
  const theta = (Math.acos(EARTH_R / dist) * 180) / Math.PI;      // angle from the centre to the tangent point
  // Walk theta degrees north of the centre along its meridian.
  const [x, y] = project(f, v.lon, v.lat + theta * 0.999, 0)!;
  near(Math.hypot(x - 640, y - 400), limbPx(v), 2);
  assert.ok(limbPx(v) > 100 && limbPx(v) < 400, `limb ${limbPx(v)}`);
});

test('the atmosphere fades from 1 at zoom 0 to 0 at zoom 2, as in the original sky', () => {
  assert.equal(atmosphereBlend(0), 1);
  near(atmosphereBlend(1), 0.5, 1e-9);
  assert.equal(atmosphereBlend(2), 0);
  assert.equal(atmosphereBlend(9), 0);
});

test('points behind the globe do not project', () => {
  const f = frame({ ...base, zoom: 1 });
  assert.equal(project(f, base.lon + 180, -base.lat, 0), null);
});

test('unproject is the inverse of project on the ground, off centre and pitched', () => {
  const v = { ...base, pitch: 65, bearing: 57, zoom: 9.5, centerH: 200 };
  const f = frame(v);
  for (const [lon, lat] of [[140.5, 39.8], [140.3, 39.65], [140.62, 39.7]]) {
    const [x, y] = project(f, lon, lat, 200)!;
    const [lo, la] = unproject(f, x, y, 200)!;
    near(lo, lon, 1e-6, 'lon'); near(la, lat, 1e-6, 'lat');
  }
  assert.equal(unproject(frame({ ...base, zoom: 1 }), 2, 2, 0), null, 'a corner of a whole-globe view is space');
});
