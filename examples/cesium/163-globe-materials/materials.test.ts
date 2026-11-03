import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isContourLine,
  evaluateElevationColor,
  computeRadarIntensity,
  generateGlobeMesh,
} from './materials.ts';

describe('cesium-163-globe-materials', () => {
  it('isContourLine identifies elevation intervals accurately', () => {
    const spacing = 100;
    const width = 5;

    // Directly on contour interval (0, 100, 200, ...)
    assert.equal(isContourLine(100, spacing, width), true);
    assert.equal(isContourLine(202, spacing, width), true); // within width
    assert.equal(isContourLine(250, spacing, width), false); // halfway between contours
    assert.equal(isContourLine(98, spacing, width), true); // within width
  });

  it('evaluateElevationColor maps normalized height to hypsometric color', () => {
    // 0.0 is deep ocean
    const sea = evaluateElevationColor(0.0);
    assert.ok(sea[2] > sea[0], 'ocean has dominant blue');

    // 0.4 is lush plains / greenery
    const plains = evaluateElevationColor(0.4);
    assert.ok(plains[1] > plains[2], 'plains have dominant green');

    // 1.0 is snow peak
    const peak = evaluateElevationColor(1.0);
    assert.ok(peak[0] > 0.8 && peak[1] > 0.8 && peak[2] > 0.8, 'peaks are white snow');
  });

  it('computeRadarIntensity produces peak at beam azimuth and decays with angle', () => {
    const currentSweep = Math.PI * 0.5; // 90 deg
    const beamWidth = Math.PI * 0.2;

    // Directly under beam
    const peak = computeRadarIntensity(Math.PI * 0.5, currentSweep, beamWidth);
    assert.ok(Math.abs(peak - 1.0) < 1e-4, 'intensity is 1.0 at sweep front');

    // In trail behind beam (positive decay)
    const trail = computeRadarIntensity(Math.PI * 0.45, currentSweep, beamWidth);
    assert.ok(trail > 0.0 && trail < 1.0, 'trail has positive decaying intensity');

    // Ahead of beam (outside beam width)
    const ahead = computeRadarIntensity(Math.PI * 0.55, currentSweep, beamWidth);
    assert.equal(ahead, 0.0, 'ahead of beam is 0');
  });

  it('generateGlobeMesh creates valid vertex and index buffers with normals and elevations', () => {
    const mesh = generateGlobeMesh(16, 32, 100.0);
    assert.ok(mesh.positions.length > 0);
    assert.ok(mesh.normals.length === mesh.positions.length);
    assert.ok(mesh.elevations.length * 3 === mesh.positions.length);
    assert.ok(mesh.indices.length > 0);

    // Verify indices point within vertex bounds
    const vertCount = mesh.positions.length / 3;
    for (let i = 0; i < mesh.indices.length; i++) {
      assert.ok(mesh.indices[i] < vertCount);
    }
  });
});
