import test from 'node:test';
import assert from 'node:assert/strict';
import { hexToRgb, fogOpacity, skyUniforms, DEFAULT_SKY, RELIEF, reliefGlsl, fogDepthGlsl, FOG_FAR } from './sky.ts';

test('hexToRgb reads #rrggbb as 0..1 floats', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [1, 0, 0]);
  assert.deepEqual(hexToRgb('#00ff80').map((v) => Math.round(v * 255)), [0, 255, 128]);
  assert.throws(() => hexToRgb('blue'));
});

test('fog fades in between pitch 60 and 70, as MapLibre calculateFogBlendOpacity', () => {
  assert.equal(fogOpacity(50), 0);
  assert.equal(fogOpacity(65), 0.5);
  assert.equal(fogOpacity(77), 1);
});

test('sky uniforms: horizon row from the bottom in device pixels, blend band as a fraction of half the height', () => {
  const u = skyUniforms({ ...DEFAULT_SKY, skyHorizonBlend: 0.5 }, 77, 800, 2, 20000);
  // horizonY(77, 800) = 122.6 css px from the top -> (800 - 122.6) * 2 from the bottom
  assert.ok(Math.abs(u.horizonFrag - (800 - 122.6) * 2) < 1, String(u.horizonFrag));
  assert.equal(u.skyBlendPx, 0.5 * 400 * 2);
  assert.equal(u.fogNear, 20000);
  assert.equal(u.fogFar, FOG_FAR);
  assert.equal(u.fogOpacity, 1);
  // disabled: no fog at all, whatever the pitch
  assert.equal(skyUniforms({ ...DEFAULT_SKY, enabled: false }, 77, 800, 1, 20000).fogOpacity, 0);
});

test('the fog far plane never sits in front of the near plane', () => {
  assert.ok(skyUniforms(DEFAULT_SKY, 77, 800, 1, 1e6).fogFar > 1e6);
});

test('colour relief stops ascend and cover sea level to above the highest peak in the data', () => {
  for (let i = 1; i < RELIEF.length; i++) assert.ok(RELIEF[i][0] > RELIEF[i - 1][0]);
  assert.ok(RELIEF[0][0] <= 0 && RELIEF[RELIEF.length - 1][0] >= 3190);
  // the shader is built from the same table: one mix per interval
  const glsl = reliefGlsl();
  assert.equal(glsl.match(/smoothstep/g)?.length, RELIEF.length - 1);
  assert.match(fogDepthGlsl, /u_fog_far/);
});
