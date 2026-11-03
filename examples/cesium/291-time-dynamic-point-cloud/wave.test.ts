import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateHarmonicWave,
  sampleWaveColor,
  generatePointGrid,
} from './wave.ts';

describe('cesium-291-time-dynamic-point-cloud', () => {
  it('evaluateHarmonicWave returns bounded dynamic elevation for given coordinates and time', () => {
    for (let t = 0; t <= 5.0; t += 1.0) {
      const z0 = evaluateHarmonicWave(0, 0, t);
      assert.ok(Math.abs(z0) <= 25.0, `elevation ${z0} within amplitude bounds`);

      const z1 = evaluateHarmonicWave(20, -15, t);
      assert.ok(Math.abs(z1) <= 25.0);
    }

    // Time dynamics: z changes over time
    const zT0 = evaluateHarmonicWave(10, 10, 0.0);
    const zT1 = evaluateHarmonicWave(10, 10, 1.5);
    assert.notEqual(zT0, zT1, 'elevation varies dynamically over time');
  });

  it('sampleWaveColor maps normalized elevation to vibrant dynamic palette', () => {
    // Trough (min elevation -1.0) -> deep sapphire blue
    const trough = sampleWaveColor(-1.0);
    assert.ok(trough[2] > trough[0] && trough[2] > trough[1], 'trough is predominantly blue');

    // Mid-level (0.0) -> turquoise/emerald
    const mid = sampleWaveColor(0.0);
    assert.ok(mid[1] > 0.4, 'mid-level has emerald/turquoise green');

    // Crest (1.0) -> bright golden-white crest
    const crest = sampleWaveColor(1.0);
    assert.ok(crest[0] > 0.8 && crest[1] > 0.8, 'crest has brilliant golden white radiance');
  });

  it('generatePointGrid produces uniform 2D grid coordinates for point cloud', () => {
    const grid = generatePointGrid(64, 64, 120.0, 120.0);
    const expectedPoints = 64 * 64;

    assert.equal(grid.positions.length, expectedPoints * 3);
    assert.equal(grid.uvs.length, expectedPoints * 2);

    // Bounds check
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < expectedPoints; i++) {
      const x = grid.positions[i * 3 + 0];
      const z = grid.positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    assert.ok(minX >= -60.1 && maxX <= 60.1);
    assert.ok(minZ >= -60.1 && maxZ <= 60.1);
  });
});
