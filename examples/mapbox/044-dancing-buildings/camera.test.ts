import test from 'node:test';
import assert from 'node:assert/strict';
import { makeView, project, groundAt, panBy, zoomAt, type Cam } from './camera.ts';

const W = 1280, H = 800;
const cam = (o: Partial<Cam> = {}): Cam => ({ cx: 0, cy: 0, bearing: 0, pitch: 60, distance: 1500, ...o });
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('the target is at the centre of the screen', () => {
  for (const c of [cam(), cam({ bearing: 137, pitch: 20, cx: 300, cy: -50 })]) {
    const p = project(makeView(c, W, H), [c.cx, c.cy, 0])!;
    near(p[0], W / 2, 1e-6, 'x'); near(p[1], H / 2, 1e-6, 'y');
  }
});

test('higher is higher on screen, and a taller roof rises further (buildings stand up, not down)', () => {
  const v = makeView(cam(), W, H);
  const g = project(v, [0, 200, 0])!, r1 = project(v, [0, 200, 100])!, r2 = project(v, [0, 200, 250])!;
  assert.ok(r1[1] < g[1] - 10, `roof ${r1[1]} above ground ${g[1]}`);
  assert.ok(r2[1] < r1[1] - 10);
});

test('bearing 0 faces north: north is up the screen, east is right; bearing 90 faces east', () => {
  const v = makeView(cam(), W, H);
  assert.ok(project(v, [0, 300, 0])![1] < H / 2);
  assert.ok(project(v, [300, 0, 0])![0] > W / 2);
  const e = makeView(cam({ bearing: 90 }), W, H);
  assert.ok(project(e, [300, 0, 0])![1] < H / 2, 'east is ahead');
  assert.ok(project(e, [0, -300, 0])![0] > W / 2, 'south is right');
});

test('groundAt inverts project on the ground plane', () => {
  const v = makeView(cam({ bearing: 33, pitch: 55, cx: 120, cy: 80 }), W, H);
  for (const q of [[0, 0], [400, 250], [-200, 600]]) {
    const s = project(v, [q[0], q[1], 0])!;
    const g = groundAt(v, s[0], s[1])!;
    near(g[0], q[0], 0.01, 'x'); near(g[1], q[1], 0.01, 'y');
  }
});

test('a drag moves the ground with the pointer, in both axes and at any bearing', () => {
  for (const bearing of [0, 90, 215]) {
    const c = cam({ bearing, pitch: 50 });
    const v0 = makeView(c, W, H);
    const from: [number, number] = [W / 2 + 40, H / 2 + 30];
    const p = groundAt(v0, from[0], from[1])!;
    const moved = panBy(c, v0, from[0], from[1], from[0] + 120, from[1] + 80);
    const s = project(makeView(moved, W, H), [p[0], p[1], 0])!;
    near(s[0], from[0] + 120, 0.5, `x at bearing ${bearing}`);
    near(s[1], from[1] + 80, 0.5, `y at bearing ${bearing}`);
  }
});

test('wheel zoom keeps the ground point under the pointer', () => {
  const c = cam({ bearing: 40 });
  const v = makeView(c, W, H);
  const p = groundAt(v, 900, 500)!;
  const z = zoomAt(c, v, 900, 500, 0.6);
  assert.ok(z.distance < c.distance);
  const s = project(makeView(z, W, H), [p[0], p[1], 0])!;
  near(s[0], 900, 0.5, 'x'); near(s[1], 500, 0.5, 'y');
});
