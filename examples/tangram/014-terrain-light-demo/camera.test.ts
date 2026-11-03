import assert from 'node:assert/strict';
import test from 'node:test';
import { type Cam, basis, eye, project, orbit, zoomAt, lightFromPointer, DIST_MIN, TILT_MAX } from './camera.ts';
import { lightDir } from './light.ts';

const W = 1280, H = 800;
const cam = (): Cam => ({ tx: 0, ty: 0, tz: 1000, bearing: 0, tilt: 0.6, dist: 40000, fovy: 0.7 });
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('the sky is at the top: up has a positive z and the eye is above the target', () => {
  for (const bearing of [0, 1, 2.5, -2]) {
    const c = { ...cam(), bearing };
    assert.ok(basis(c).u[2] > 0, `up.z at bearing ${bearing}`);
    assert.ok(eye(c)[2] > c.tz);
  }
});

test('bearing 0 looks north: north is up the screen, east is right', () => {
  const c = cam();
  const t = project(c, [0, 0, 1000], W, H)!;
  assert.ok(near(t.x, W / 2, 1e-3) && near(t.y, H / 2, 1e-3), 'target at the centre');
  const n = project(c, [0, 3000, 1000], W, H)!, e = project(c, [3000, 0, 1000], W, H)!;
  assert.ok(n.y < t.y, 'north above');
  assert.ok(e.x > t.x, 'east right');
  const peak = project(c, [0, 0, 4000], W, H)!;
  assert.ok(peak.y < t.y, 'a peak rises towards the top');
});

test('dragging right carries the near ground to the right, dragging down tilts towards top-down', () => {
  const c = cam();
  const south = [0, -5000, 1000] as const;
  const before = project(c, [...south], W, H)!;
  orbit(c, 40, 0);
  const after = project(c, [...south], W, H)!;
  assert.ok(after.x > before.x + 5, `near ground moved right: ${before.x} -> ${after.x}`);
  const t0 = c.tilt;
  orbit(c, 0, 50);
  assert.ok(c.tilt > t0);
  orbit(c, 0, 1e6);
  assert.equal(c.tilt, TILT_MAX);
});

test('wheel zoom keeps the ground point under the pointer in place', () => {
  const c = cam();
  const sx = 900, sy = 520;
  // find the ground point (z = tz) under the pointer by projecting a fine search
  const target = (cc: Cam) => {
    const { f, r, u } = basis(cc), e = eye(cc), th = Math.tan(cc.fovy / 2);
    const nx = (2 * sx) / W - 1, ny = 1 - (2 * sy) / H;
    const d = [0, 1, 2].map((k) => f[k] + r[k] * nx * th * (W / H) + u[k] * ny * th);
    const t = (cc.tz - e[2]) / d[2];
    return [e[0] + d[0] * t, e[1] + d[1] * t, cc.tz];
  };
  const p = target(c);
  zoomAt(c, 0.5, sx, sy, W, H);
  assert.ok(near(c.dist, 20000));
  const q = project(c, p, W, H)!;
  assert.ok(near(q.x, sx, 1e-6) && near(q.y, sy, 1e-6), `${q.x},${q.y}`);
  zoomAt(c, 1e-6, sx, sy, W, H);
  assert.equal(c.dist, DIST_MIN);
});

test('the light comes from the pointer side of the screen; altitude falls with distance from the centre', () => {
  for (const bearing of [0, 0.8, 3]) {
    const c = { ...cam(), bearing };
    const l = lightFromPointer(W / 2 + 300, H / 2, W, H, bearing);
    const d = lightDir(l.az, l.alt);
    const centre = project(c, [0, 0, 1000], W, H)!;
    const toward = project(c, [d[0] * 2000, d[1] * 2000, 1000], W, H)!;
    assert.ok(toward.x > centre.x + 50 && Math.abs(toward.y - centre.y) < 60, `bearing ${bearing}: light towards screen right`);
  }
  assert.ok(near(lightFromPointer(W / 2, H / 2, W, H, 0).alt, Math.PI / 2));
  const mid = lightFromPointer(W / 2, H / 2 - 200, W, H, 0), edge = lightFromPointer(W / 2, 0, W, H, 0);
  assert.ok(mid.alt < Math.PI / 2 && edge.alt < mid.alt && edge.alt > 0);
  assert.ok(near(mid.az, 0), 'pointer above the centre at bearing 0: light from the north');
});
