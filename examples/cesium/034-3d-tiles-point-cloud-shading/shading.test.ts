import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, EDL, POINT_VS, EDL_FS, edlActive, edlUniforms, pointUniforms, nodeGeometricError, type Shading } from './shading.ts';

const inner = { geometricError: 2.2, min: [0, 0, 0] as [number, number, number], max: [500, 500, 250] as [number, number, number], count: 50_000 };
const leaf = { ...inner, geometricError: 0, max: [120, 120, 60] as [number, number, number] };
const s = (o: Partial<Shading> = {}): Shading => ({ ...DEFAULTS, ...o });

test('an inner node attenuates by its own geometric error, times the scale', () => {
  assert.equal(nodeGeometricError(inner, s()), 2.2);
  const u = pointUniforms(inner, s({ geometricErrorScale: 0.5 }), 16, 800, 1);
  assert.ok(Math.abs(u.geometricError - 1.1) < 1e-12);
});

test('a leaf uses the base resolution, or Cesium\'s cbrt(volume / count) estimate when it is 0', () => {
  assert.equal(nodeGeometricError(leaf, s({ baseResolution: 0.3 })), 0.3);
  assert.ok(Math.abs(nodeGeometricError(leaf, s()) - Math.cbrt(120 * 120 * 60 / 50_000)) < 1e-12);
  // The base resolution does not override an inner node's own error.
  assert.equal(nodeGeometricError(inner, s({ baseResolution: 0.3 })), 2.2);
});

test('maximum attenuation 0 means "use the maximum screen space error", in device pixels', () => {
  assert.equal(pointUniforms(inner, s(), 16, 800, 2).maxSize, 32);
  assert.equal(pointUniforms(inner, s({ maximumAttenuation: 4 }), 16, 800, 2).maxSize, 8);
});

test('the depth multiplier is buffer height over 2 tan(fovy / 2)', () => {
  const u = pointUniforms(inner, s(), 16, 800, 1);
  assert.ok(Math.abs(u.depthMultiplier - 800 / (2 * Math.tan(Math.PI / 6))) < 1e-9);
});

test('without attenuation every point is one pixel', () => {
  const u = pointUniforms(inner, s({ attenuation: false }), 16, 800, 2);
  assert.equal(u.attenuate, false);
  assert.equal(u.maxSize, 1);
});

test('EDL runs only with attenuation on, as Cesium3DTileset does', () => {
  assert.equal(edlActive(s()), true);
  assert.equal(edlActive(s({ attenuation: false })), false);
  assert.equal(edlActive(s({ eyeDomeLighting: false })), false);
});

test('the EDL radius is scaled by the device pixel ratio, the strength is not', () => {
  assert.deepEqual(edlUniforms(s({ eyeDomeLightingRadius: 1.5, eyeDomeLightingStrength: 3 }), 2), { radius: 3, strength: 3 });
});

test('the shaders are built from the EDL constants this test reads', () => {
  // The obscurance-to-shade constant and the four neighbour directions
  // appear in the EDL pass exactly as exported.
  assert.ok(EDL_FS.includes(`exp(-response * ${EDL.responseScale.toFixed(1)} * u_strength)`));
  for (const [x, y] of EDL.neighbours) assert.ok(EDL_FS.includes(`neighbour(p, logDepth, vec2(${x.toFixed(1)}, ${y.toFixed(1)}))`), `${x},${y}`);
  assert.ok(EDL_FS.includes(`>= ${EDL.clearDepth.toFixed(1)}`));
  assert.ok(EDL_FS.includes('log2('), 'EDL compares log depths');
  // Attenuation: min(geometricError / depth * depthMultiplier, maximum).
  assert.ok(POINT_VS.includes('min(u_point.y / depth * u_point.z, u_point.x)'));
  assert.equal(EDL.responseScale, 300);
});
