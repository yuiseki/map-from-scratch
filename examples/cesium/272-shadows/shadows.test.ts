import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeSunDirection,
  calculateShadowBias,
  generateShadowSceneGeometry,
  mat4Ortho,
} from './shadows.ts';

describe('cesium-272-shadows', () => {
  it('computeSunDirection calculates normalized light vector from azimuth and elevation', () => {
    // Sun at zenith (elevation 90 deg = PI/2)
    const zenith = computeSunDirection(0, Math.PI / 2);
    assert.ok(Math.abs(zenith[0]) < 1e-4);
    assert.ok(Math.abs(zenith[1] - 1.0) < 1e-4);
    assert.ok(Math.abs(zenith[2]) < 1e-4);

    // Sun at 45 deg elevation, 0 deg azimuth (+Z)
    const angled = computeSunDirection(0, Math.PI / 4);
    const len = Math.hypot(angled[0], angled[1], angled[2]);
    assert.ok(Math.abs(len - 1.0) < 1e-4, 'sun direction is normalized');
    assert.ok(angled[1] > 0.7 && angled[2] > 0.7);
  });

  it('calculateShadowBias increases bias at grazing angles to prevent shadow acne', () => {
    const normal = [0, 1, 0];
    const directLight = [0, 1, 0]; // dot = 1.0 (perpendicular)
    const grazingLight = [0.95, 0.31, 0]; // dot = 0.31 (grazing)

    const biasDirect = calculateShadowBias(normal, directLight);
    const biasGrazing = calculateShadowBias(normal, grazingLight);

    assert.ok(biasGrazing > biasDirect, 'grazing light has higher bias than direct light');
    assert.ok(biasDirect >= 0.0005 && biasGrazing <= 0.015);
  });

  it('mat4Ortho produces valid orthographic projection matrix', () => {
    const m = new Float32Array(16);
    mat4Ortho(m, -50, 50, -50, 50, 1, 200);

    // Diagonal scaling
    assert.ok(Math.abs(m[0] - 2 / 100) < 1e-4); // 2 / (right - left)
    assert.ok(Math.abs(m[5] - 2 / 100) < 1e-4); // 2 / (top - bottom)
    assert.ok(Math.abs(m[15] - 1.0) < 1e-4);
  });

  it('generateShadowSceneGeometry creates ground plane and 3D occluder towers', () => {
    const scene = generateShadowSceneGeometry(8);

    assert.ok(scene.positions.length > 0);
    assert.ok(scene.normals.length === scene.positions.length);
    assert.ok(scene.colors.length === (scene.positions.length / 3) * 4);
    assert.ok(scene.indices.length > 0);

    // Verify presence of vertical faces (normals with |nx| > 0.9 or |nz| > 0.9)
    let hasVerticalWalls = false;
    for (let i = 0; i < scene.normals.length; i += 3) {
      if (Math.abs(scene.normals[i]) > 0.9 || Math.abs(scene.normals[i + 2]) > 0.9) {
        hasVerticalWalls = true;
        break;
      }
    }
    assert.ok(hasVerticalWalls, 'scene contains vertical walls for shadow occlusion');
  });
});
