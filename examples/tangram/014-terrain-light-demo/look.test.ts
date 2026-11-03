import assert from 'node:assert/strict';
import test from 'node:test';
import { ALBEDO, ZENITH, LIGHT, EXAG, VIEW, albedoAt, sunColor, skyAt, horizonColor, hazeAt, openingCam } from './look.ts';
import { basis, project } from './camera.ts';
import { lonLatToTexel, texelToLocal } from './grid.ts';
import { terrainFragment, skyFragment } from './shaders.ts';

// The baked grid's header and height range (bake.ts output, spec.yaml
// datasets.preparation); CI has no data/, so they are written out here.
const META = { w: 1280, h: 1024, z: 11, x0: 927728, y0: 413294, cell: 31.14 };
const H_REF = 235.56, H_SUMMIT = 3769.79, FOOT = 1000;
const SUMMIT: [number, number] = [138.7274, 35.3606];
const W = 1280, H = 800, RAD = Math.PI / 180;

test('the ramp is hypsometric: green lowlands, brown upper slopes, a near-white summit', () => {
  for (const h of [300, 600, 900]) {
    const [r, g, b] = albedoAt(h);
    assert.ok(g > 1.4 * r && g > 1.4 * b, `${h} m is green: ${[r, g, b]}`);
  }
  for (const h of [2400, 2700]) {
    const [r, g, b] = albedoAt(h);
    assert.ok(r > g && g > b && r > 1.3 * b, `${h} m is brown: ${[r, g, b]}`);
  }
  const top = albedoAt(H_SUMMIT);
  assert.ok(Math.min(...top) > 0.8, `summit near white: ${top}`);
  assert.ok(Math.max(...top) - Math.min(...top) < 0.08, 'and not tinted');
  // the snow is brighter than anything below it: the summit reads first
  for (let h = 0; h < 3000; h += 100) assert.ok(Math.max(...albedoAt(h)) < 0.5 * Math.min(...top), `${h} m darker than the summit`);
});

test('the shaders are built from the same ramp and sky colours', () => {
  const fs = terrainFragment();
  ALBEDO.forEach(([h, c], k) => {
    assert.ok(fs.includes(`vec3(${c.map((x) => x.toFixed(4)).join(', ')})`), `colour of ${h} m in the shader`);
    if (k > 0) assert.ok(fs.includes(`clamp((h - ${ALBEDO[k - 1][0].toFixed(1)}) / ${(h - ALBEDO[k - 1][0]).toFixed(1)}`), `stop ${h} m in the shader`);
  });
  assert.ok(skyFragment().includes(`vec3(${ZENITH.map((x) => x.toFixed(4)).join(', ')})`));
});

test('the opening view frames Fuji large, with the sky above it', () => {
  const cam = openingCam(META, H_REF);
  const s = lonLatToTexel(...SUMMIT, META), p = texelToLocal(s.i, s.j, META);
  const top = project(cam, [p.x, p.y, (H_SUMMIT - H_REF) * EXAG], W, H)!;
  const foot = project(cam, [p.x, p.y, (FOOT - H_REF) * EXAG], W, H)!;
  assert.ok(top.x > 0.25 * W && top.x < 0.75 * W, `summit near the middle: x ${top.x}`);
  assert.ok(top.y > 0.12 * H && top.y < 0.5 * H, `summit in the upper half, below the top: y ${top.y}`);
  assert.ok(foot.y - top.y > 0.25 * H, `Fuji stands ${foot.y - top.y} px above its ${FOOT} m foot`);
  // the top rows of the screen look above the horizon: sky, not a void
  const { f, u } = basis(cam), th = Math.tan(cam.fovy / 2);
  const ny = 1 - (2 * 0.05 * H) / H;
  const dz = f[2] + u[2] * ny * th;
  assert.ok(dz > 0, `the ray 5% below the top rises: ${dz}`);
});

test('the opening light is a low warm sun from the side, so Fuji casts a long shadow', () => {
  assert.ok(LIGHT.alt < 12 * RAD && LIGHT.alt > 4 * RAD, `altitude ${LIGHT.alt / RAD}`);
  const shadow = ((H_SUMMIT - FOOT) * EXAG) / Math.tan(LIGHT.alt);
  assert.ok(shadow > 15000 && shadow < 60000, `Fuji's shadow ${Math.round(shadow)} m`);
  assert.ok(Math.abs(Math.sin(LIGHT.az - VIEW.bearing)) > 0.7, 'light from the side of the view: the shadow lies across the screen');
  const c = sunColor(LIGHT.alt);
  assert.ok(c[0] / c[2] > 1.5, `warm: ${c}`);
  const noon = sunColor(55 * RAD);
  assert.ok(noon[0] / noon[2] < 1.2, 'a high sun is white');
});

test('the sky darkens upwards from a horizon tinted by the sun, and the haze reaches it far away', () => {
  const white: [number, number, number] = [1, 1, 1];
  const hz = skyAt(0, white), up = skyAt(1, white);
  assert.deepEqual(up.map((v) => +v.toFixed(6)), ZENITH.map((v) => +v.toFixed(6)));
  assert.ok(hz[0] + hz[1] + hz[2] > 2 * (up[0] + up[1] + up[2]), 'horizon brighter than zenith');
  assert.ok(up[2] > up[0], 'zenith blue');
  const warm = horizonColor(sunColor(LIGHT.alt));
  assert.ok(warm[0] / warm[2] > hz[0] / hz[2], 'a low sun warms the horizon');
  for (const dist of [VIEW.dist, 70000]) {
    assert.equal(hazeAt(dist + 2000, dist), 0, `at ${dist} m out, what the camera looks at is clear`);
    const far = hazeAt(dist + 22000, dist);
    assert.ok(far > 0.3 && far < 0.85, `the far edge, 22 km past the target, fades: ${far}`);
  }
});
