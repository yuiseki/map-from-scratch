import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSampleKernel,
  generateNoiseTexture,
  computeOcclusionFactor,
  buildBlockCityGeometry,
} from './ssao.ts';

describe('SSAO Calculations', () => {
  it('generateSampleKernel creates valid hemisphere sample points clustered near origin', () => {
    const size = 16;
    const kernel = generateSampleKernel(size);
    assert.equal(kernel.length, size * 3, 'Kernel must contain 3 components per sample');

    for (let i = 0; i < size; i++) {
      const x = kernel[i * 3 + 0];
      const y = kernel[i * 3 + 1];
      const z = kernel[i * 3 + 2];

      const len = Math.hypot(x, y, z);
      assert.ok(len <= 1.0001, `Sample ${i} length ${len} must be <= 1.0`);
      assert.ok(z >= 0.0, `Sample ${i} z-component ${z} must be in hemisphere (z >= 0)`);
    }

    // Earlier samples should generally be closer to origin than later samples due to quadratic distribution
    const firstLen = Math.hypot(kernel[0], kernel[1], kernel[2]);
    const lastLen = Math.hypot(kernel[(size - 1) * 3], kernel[(size - 1) * 3 + 1], kernel[(size - 1) * 3 + 2]);
    assert.ok(firstLen < lastLen, `First sample distance ${firstLen} should be smaller than last sample ${lastLen}`);
  });

  it('generateNoiseTexture generates normalized 2D rotation vectors for kernel jitter', () => {
    const dim = 4;
    const noise = generateNoiseTexture(dim);
    assert.equal(noise.length, dim * dim * 3, 'Noise texture must have 3 components per pixel');

    for (let i = 0; i < dim * dim; i++) {
      const x = noise[i * 3 + 0];
      const y = noise[i * 3 + 1];
      const z = noise[i * 3 + 2];

      assert.equal(z, 0.0, 'Rotation noise lies on tangent XY plane (z = 0)');
      const len = Math.hypot(x, y);
      assert.ok(Math.abs(len - 1.0) < 1e-4, `Rotation vector ${i} must be unit length, got ${len}`);
    }
  });

  it('computeOcclusionFactor produces correct contact occlusion with smooth range check', () => {
    const radius = 2.0;

    // Occluder is strictly in front of sample position within radius -> occluded
    const occClose = computeOcclusionFactor(5.0, 4.5, radius);
    assert.ok(occClose > 0.5, `Close occluder must produce high occlusion, got ${occClose}`);

    // Occluder is outside influence radius -> zero occlusion (no halo artifact)
    const occFar = computeOcclusionFactor(5.0, 1.0, radius);
    assert.equal(occFar, 0.0, `Occluder beyond radius must produce zero occlusion`);

    // Occluder is behind the sample -> no occlusion
    const occBehind = computeOcclusionFactor(5.0, 6.0, radius);
    assert.equal(occBehind, 0.0, `Occluder behind sample must produce zero occlusion`);
  });

  it('buildBlockCityGeometry creates 3D urban canyons with non-empty positions, normals and colors', () => {
    const city = buildBlockCityGeometry(4, 4);
    assert.ok(city.positions.length > 0, 'City mesh must contain vertex positions');
    assert.ok(city.normals.length === city.positions.length, 'Normal count must match position count');
    assert.ok(city.colors.length === (city.positions.length / 3) * 4, 'Color RGBA count must match vertex count');
    assert.ok(city.indices.length > 0, 'City mesh must contain triangle indices');
  });
});
