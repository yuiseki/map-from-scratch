import assert from 'node:assert/strict';
import test from 'node:test';
import { lightDir, sunAt, sunPhase, marchGrowth, SUN_MAX_ALT, SHADOW_STEPS } from './light.ts';
import { shadowFragment } from './shaders.ts';

const deg = (r: number) => (r * 180) / Math.PI;

test('light direction points at the light: azimuth clockwise from north, altitude up', () => {
  const e = lightDir(Math.PI / 2, 0);
  assert.ok(Math.abs(e[0] - 1) < 1e-9 && Math.abs(e[1]) < 1e-9 && Math.abs(e[2]) < 1e-9);
  const n = lightDir(0, Math.PI / 6);
  assert.ok(Math.abs(n[1] - Math.cos(Math.PI / 6)) < 1e-9 && Math.abs(n[2] - 0.5) < 1e-9);
});

test('the sun rises in the east, is highest in the south at noon and sets in the west', () => {
  const rise = sunAt(0.02), noon = sunAt(0.5), set = sunAt(0.98);
  assert.ok(Math.abs(deg(rise.az) - 90) < 10 && deg(rise.alt) < 8, `rise ${deg(rise.az)} ${deg(rise.alt)}`);
  assert.ok(Math.abs(deg(noon.az) - 180) < 1e-6 && Math.abs(noon.alt - SUN_MAX_ALT) < 1e-9);
  assert.ok(Math.abs(deg(set.az) - 270) < 10 && deg(set.alt) < 8);
  assert.ok(sunAt(0).alt > 0, 'never below the horizon: the terrain is never black');
  // low sun is warmer (more red than blue) than the noon sun
  assert.ok(rise.color[0] / rise.color[2] > 1.5 * (noon.color[0] / noon.color[2]));
});

test('the sun clock advances with time and wraps after a day', () => {
  assert.equal(sunPhase(1000, 1000, 0.25, 20000), 0.25);
  assert.ok(Math.abs(sunPhase(6000, 1000, 0.25, 20000) - 0.5) < 1e-12);
  assert.ok(Math.abs(sunPhase(21000, 1000, 0.25, 20000) - 0.25) < 1e-12);
});

test('the shadow march reaches across the whole grid, starting one texel out', () => {
  const diag = Math.hypot(1280, 1024);
  const g = marchGrowth(SHADOW_STEPS, diag);
  assert.ok(g > 1);
  assert.ok(Math.abs(g ** (SHADOW_STEPS - 1) - diag) < 1e-6 * diag);
  // the shader loops SHADOW_STEPS times and multiplies by the growth uniform
  const src = shadowFragment();
  assert.match(src, new RegExp(`k < ${SHADOW_STEPS};`));
  assert.match(src, /s \*= u_growth;/);
});
