import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateFresnelAlpha,
  generateSubterraneanFeatures,
  generateLayeredGlobeMesh,
} from './translucency.ts';

describe('cesium-166-globe-translucency', () => {
  it('calculateFresnelAlpha produces higher translucency at center and opacity at glancing edges', () => {
    const baseAlpha = 0.4;
    const power = 2.0;

    // Normal directly facing camera (cosTheta = 1.0) -> minimal edge opacity
    const centerAlpha = calculateFresnelAlpha(1.0, baseAlpha, power);
    assert.ok(Math.abs(centerAlpha - baseAlpha * 0.2) < 1e-4);

    // Normal perpendicular to camera (cosTheta = 0.0) -> maximal limb opacity (1.0)
    const limbAlpha = calculateFresnelAlpha(0.0, baseAlpha, power);
    assert.ok(Math.abs(limbAlpha - 1.0) < 1e-4);

    assert.ok(centerAlpha < limbAlpha, 'center is more translucent than limb');
  });

  it('generateSubterraneanFeatures positions all underground objects inside planetary radius', () => {
    const globeRadius = 100.0;
    const features = generateSubterraneanFeatures(globeRadius, 20);

    assert.equal(features.length, 20);
    for (const f of features) {
      const dist = Math.hypot(f.pos[0], f.pos[1], f.pos[2]);
      assert.ok(dist < globeRadius, `subterranean feature at ${dist} must be under surface ${globeRadius}`);
      assert.ok(dist >= 30.0, 'subterranean feature above the dense core');
    }
  });

  it('generateLayeredGlobeMesh produces crust, mantle, and core sphere geometry', () => {
    const mesh = generateLayeredGlobeMesh(24, 48, 100.0);

    // Crust
    assert.ok(mesh.crustPositions.length > 0);
    assert.ok(mesh.crustIndices.length > 0);

    // Mantle
    assert.ok(mesh.mantlePositions.length > 0);
    assert.ok(mesh.mantleIndices.length > 0);

    // Core
    assert.ok(mesh.corePositions.length > 0);
    assert.ok(mesh.coreIndices.length > 0);

    // Check radii: core < mantle < crust
    const pCrust = Math.hypot(mesh.crustPositions[0], mesh.crustPositions[1], mesh.crustPositions[2]);
    const pMantle = Math.hypot(mesh.mantlePositions[0], mesh.mantlePositions[1], mesh.mantlePositions[2]);
    const pCore = Math.hypot(mesh.corePositions[0], mesh.corePositions[1], mesh.corePositions[2]);

    assert.ok(pCrust >= 99.0);
    assert.ok(pMantle < pCrust && pMantle >= 60.0);
    assert.ok(pCore < pMantle && pCore >= 28.0);
  });
});
