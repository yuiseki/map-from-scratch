import assert from 'node:assert/strict';
import test from 'node:test';
import { project, pick, drag, zoomAt, flyBetween, viewProj, onNearSide, clampCam, JAPAN, FUJI, type Cam } from './camera.ts';
import { toEcef } from './land.ts';

const W = 1280, H = 800, O = toEcef(137.5, 36.5, 0);
const top: Cam = { lon: 138, lat: 36, range: 500, heading: 0, tilt: 0 };
const px = (c: Cam, lon: number, lat: number) => project(c, W, H, toEcef(lon, lat, 0))!;

test('top-down: the target is at the centre, east is right and north is up', () => {
  const c = px(top, 138, 36);
  assert.ok(Math.abs(c[0] - W / 2) < 1e-6 && Math.abs(c[1] - H / 2) < 1e-6);
  const e = px(top, 138.5, 36), n = px(top, 138, 36.5);
  assert.ok(e[0] > c[0] + 10 && Math.abs(e[1] - c[1]) < 2, 'east to the right');
  assert.ok(n[1] < c[1] - 10 && Math.abs(n[0] - c[0]) < 2, 'north up');
});

test('heading 90° looks east: east is up and north is left', () => {
  const c: Cam = { ...top, heading: Math.PI / 2 };
  const m = px(c, 138, 36), e = px(c, 138.5, 36), n = px(c, 138, 36.5);
  assert.ok(e[1] < m[1] - 10, 'east up');
  assert.ok(n[0] < m[0] - 10, 'north left');
});

test('tilted: ground ahead is above the centre and the horizon is in view', () => {
  const c: Cam = { ...top, range: 60, tilt: (65 * Math.PI) / 180 };
  const ahead = px(c, 138, 36.2), behind = px(c, 138, 35.9);
  assert.ok(ahead[1] < H / 2 && behind[1] > H / 2);
  // a point 300 km north (inside the 565 km horizon) is still on the near side and on screen, above the middle
  const far = project(c, W, H, toEcef(138, 38.7, 0));
  assert.ok(far && far[1] < H / 2 && far[1] > 0 && onNearSide(c, toEcef(138, 38.7, 0)), String(far));
});

test('pick inverts project', () => {
  for (const c of [top, FUJI, JAPAN]) {
    for (const [lon, lat] of [[138.2, 36.1], [138.7, 35.2], [139.77, 35.68]]) {
      const p = project(c, W, H, toEcef(lon, lat, 0));
      if (!p || p[0] < 0 || p[1] < 0 || p[0] > W || p[1] > H) continue;
      const g = pick(c, W, H, p[0], p[1])!;
      assert.ok(Math.abs(g[0] - lon) < 1e-6 && Math.abs(g[1] - lat) < 1e-6, `${lon},${lat} -> ${g}`);
    }
  }
});

test('the far side of the globe is not on the near side', () => {
  assert.ok(onNearSide(top, toEcef(139, 36, 0)));
  assert.ok(!onNearSide(top, toEcef(-42, -36, 0)));
});

test('dragging moves the ground with the pointer, in both axes', () => {
  for (const c0 of [top, { ...top, heading: 1 }]) {
    const p0 = px(c0, 138.3, 36.2);
    const c1 = drag(c0, 100, 0, W, H), c2 = drag(c0, 0, 80, W, H);
    const p1 = px(c1, 138.3, 36.2), p2 = px(c2, 138.3, 36.2);
    assert.ok(Math.abs(p1[0] - p0[0] - 100) < 3 && Math.abs(p1[1] - p0[1]) < 3, `right: ${p1[0] - p0[0]}, ${p1[1] - p0[1]}`);
    assert.ok(Math.abs(p2[1] - p0[1] - 80) < 3 && Math.abs(p2[0] - p0[0]) < 3, `down: ${p2[0] - p0[0]}, ${p2[1] - p0[1]}`);
  }
});

test('wheel zoom keeps the point under the pointer', () => {
  for (const c0 of [top, JAPAN]) {
    const x = 900, y = 250, g = pick(c0, W, H, x, y)!;
    for (const f of [0.5, 2]) {
      const c1 = zoomAt(c0, f, x, y, W, H);
      assert.ok(Math.abs(c1.range - c0.range * f) < 1e-6);
      const p = px(c1, g[0], g[1]);
      assert.ok(Math.hypot(p[0] - x, p[1] - y) < 1.5, `moved ${Math.hypot(p[0] - x, p[1] - y).toFixed(2)} px`);
    }
  }
});

test('camera limits: range, tilt and latitude are clamped', () => {
  const c = clampCam({ lon: 0, lat: 95, range: 1, heading: 0, tilt: 3 });
  assert.ok(c.lat <= 85 && c.range >= 5 && c.tilt <= (75 * Math.PI) / 180);
});

test('fly: starts at A, ends at B, range moves in log space without overshooting', () => {
  assert.deepEqual(flyBetween(JAPAN, FUJI, 0), JAPAN);
  assert.deepEqual(flyBetween(JAPAN, FUJI, 1), FUJI);
  let prev = JAPAN.range;
  for (let t = 0.05; t <= 1; t += 0.05) {
    const c = flyBetween(JAPAN, FUJI, t);
    assert.ok(c.range <= prev + 1e-9 && c.range >= FUJI.range - 1e-9);
    prev = c.range;
  }
});

test('the matrix is relative to the origin and agrees with project', () => {
  const { m } = viewProj(FUJI, W / H, O);
  const p = toEcef(138.66, 35.14, 0), q = [p[0] - O[0], p[1] - O[1], p[2] - O[2], 1];
  const clip = [0, 1, 2, 3].map((r) => m[r] * q[0] + m[4 + r] * q[1] + m[8 + r] * q[2] + m[12 + r]);
  const sx = (clip[0] / clip[3] * 0.5 + 0.5) * W, sy = (0.5 - clip[1] / clip[3] * 0.5) * H;
  const want = project(FUJI, W, H, p)!;
  assert.ok(Math.hypot(sx - want[0], sy - want[1]) < 0.05);
  assert.ok(Math.abs(clip[2] / clip[3]) < 1, 'inside the depth range');
});
