import test from 'node:test';
import assert from 'node:assert/strict';
import { ZERO, GAUSS_COEF, KERNEL_K, kernelExtent, rampTexture, RAMP, RAMP_SIZE, radiusZoomFactor, heatLevel, ACCUM_FS, ACCUM_VS } from './heat.ts';

test('the kernel falls to ZERO exactly at the edge of the quad the vertex shader draws', () => {
  for (const [w, i] of [[1, 1], [1, 3], [0.2, 0.5]]) {
    const s = kernelExtent(w, i);
    const atEdge = w * i * GAUSS_COEF * Math.exp(-0.5 * KERNEL_K * s * s);
    assert.ok(Math.abs(atEdge - ZERO) < 1e-12, `${atEdge}`);
  }
  assert.ok(kernelExtent(1, 3) > kernelExtent(1, 1), 'a stronger point reaches further');
});

test('the accumulation shaders are built from the same constants', () => {
  assert.ok(ACCUM_VS.includes(String(ZERO)) && ACCUM_VS.includes(String(GAUSS_COEF)));
  assert.ok(ACCUM_FS.includes(String(GAUSS_COEF)) && ACCUM_FS.includes(String(KERNEL_K)));
});

test('the colour ramp texture starts transparent and ends at the original top colour', () => {
  const t = rampTexture();
  assert.equal(t.length, RAMP_SIZE * 4);
  assert.equal(t[3], 0, 'density 0 is transparent');
  assert.deepEqual([...t.subarray(t.length - 4)], [178, 24, 43, 255]);
  // Density 0.6 is the original's rgb(253,219,199).
  const k = Math.round(0.6 * (RAMP_SIZE - 1)) * 4;
  assert.ok(Math.abs(t[k] - 253) <= 2 && Math.abs(t[k + 1] - 219) <= 2 && t[k + 3] === 255);
  assert.equal(RAMP[0][0], 0);
  assert.equal(RAMP[RAMP.length - 1][0], 1);
});

test('radius follows the original zoom curve: 2 px at zoom 0 to 20 px at zoom 9 for the default 20', () => {
  assert.ok(Math.abs(20 * radiusZoomFactor(0) - 2) < 1e-9);
  assert.ok(Math.abs(20 * radiusZoomFactor(9) - 20) < 1e-9);
  assert.equal(radiusZoomFactor(12), 1);
});

test('the accumulation level halves the target until the kernel spans at most 32 texels', () => {
  assert.equal(heatLevel(10), 0);
  assert.equal(heatLevel(32), 0);
  assert.equal(heatLevel(64), 1);
  assert.equal(heatLevel(64.5), 2);
  assert.equal(heatLevel(300), 4);
  assert.equal(heatLevel(1e9), 6);
});
