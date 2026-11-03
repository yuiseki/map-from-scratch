import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateGaussianWeights,
  extractBrightPass,
  relativeLuminance,
  generateNeonCityGeometry,
} from './bloom.ts';

describe('cesium-060-bloom', () => {
  it('calculateGaussianWeights creates symmetric weights that sum to 1.0', () => {
    const weights = calculateGaussianWeights(5, 2.5);
    assert.equal(weights.length, 5);

    // Sum of center + 2 * sum(sides) must equal ~1.0
    let total = weights[0];
    for (let i = 1; i < weights.length; i++) {
      total += 2 * weights[i];
    }
    assert.ok(Math.abs(total - 1.0) < 1e-4, `weights sum to 1.0, got ${total}`);

    // Monotonically decreasing from center
    for (let i = 0; i < weights.length - 1; i++) {
      assert.ok(weights[i] >= weights[i + 1], 'weights decrease with distance from center');
    }
  });

  it('relativeLuminance computes accurate ITU-R BT.709 photometric luminance', () => {
    // Pure green is perceptually brighter than pure blue
    const lumGreen = relativeLuminance(0, 1, 0);
    const lumBlue = relativeLuminance(0, 0, 1);
    const lumRed = relativeLuminance(1, 0, 0);

    assert.ok(lumGreen > lumRed, 'green has higher luminance than red');
    assert.ok(lumRed > lumBlue, 'red has higher luminance than blue');
    assert.ok(Math.abs(lumGreen - 0.7152) < 1e-4);
  });

  it('extractBrightPass clamps low-luminance colors to zero and retains high-luminance peaks', () => {
    const threshold = 0.6;

    // Dark color (luminance ~0.15) -> 0
    const dark = extractBrightPass([0.1, 0.15, 0.2], threshold);
    assert.deepEqual(dark, [0, 0, 0]);

    // Blazing neon cyan (luminance ~0.8) -> above threshold
    const bright = extractBrightPass([0.0, 1.0, 1.0], threshold);
    assert.ok(bright[1] > 0 && bright[2] > 0, 'bright components pass through');
  });

  it('generateNeonCityGeometry generates 3D towers with ground plane and emissive roof beacons', () => {
    const city = generateNeonCityGeometry(12);
    assert.ok(city.positions.length > 0);
    assert.ok(city.colors.length === (city.positions.length / 3) * 4);
    assert.ok(city.indices.length > 0);

    // Check that some vertices have high emissive intensity (> 1.0)
    let hasEmissive = false;
    for (let i = 0; i < city.colors.length; i += 4) {
      if (city.colors[i] > 1.0 || city.colors[i + 1] > 1.0 || city.colors[i + 2] > 1.0) {
        hasEmissive = true;
        break;
      }
    }
    assert.ok(hasEmissive, 'geometry contains high dynamic range emissive beacons');
  });
});
