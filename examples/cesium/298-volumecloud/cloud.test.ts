import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  raySphereIntersect,
  rayCloudLayerBounds,
  beerLambert,
  henyeyGreenstein,
  cloudDensityAt,
} from './cloud.ts';

describe('Volume Cloud Calculations', () => {
  it('raySphereIntersect accurately calculates entry and exit distances for a ray hitting a sphere', () => {
    const origin: [number, number, number] = [0, 0, 10];
    const dir: [number, number, number] = [0, 0, -1];
    const center: [number, number, number] = [0, 0, 0];
    const radius = 5;

    const hit = raySphereIntersect(origin, dir, center, radius);
    assert.ok(hit !== null, 'Ray pointing directly at sphere must intersect');
    assert.ok(Math.abs(hit[0] - 5.0) < 1e-4, `Expected entry at t=5, got ${hit[0]}`);
    assert.ok(Math.abs(hit[1] - 15.0) < 1e-4, `Expected exit at t=15, got ${hit[1]}`);

    // Ray pointing away from sphere
    const away = raySphereIntersect(origin, [0, 0, 1], center, radius);
    assert.equal(away, null, 'Ray pointing away must not intersect');
  });

  it('rayCloudLayerBounds finds intersections through a spherical atmospheric cloud shell', () => {
    // Camera situated at height 12 (outside cloud shell [8, 10]) looking towards center
    const origin: [number, number, number] = [0, 12, 0];
    const dir: [number, number, number] = [0, -1, 0];
    const center: [number, number, number] = [0, 0, 0];
    const innerRadius = 8;
    const outerRadius = 10;

    const bounds = rayCloudLayerBounds(origin, dir, center, innerRadius, outerRadius);
    assert.ok(bounds !== null, 'Ray pointing down into troposphere must hit cloud layer');
    // First hits outer radius at distance 12 - 10 = 2
    // Hits inner radius (earth ground / base of cloud) at distance 12 - 8 = 4
    assert.ok(Math.abs(bounds[0] - 2.0) < 1e-4, `Expected outer entry t=2, got ${bounds[0]}`);
    assert.ok(Math.abs(bounds[1] - 4.0) < 1e-4, `Expected inner entry t=4, got ${bounds[1]}`);
  });

  it('beerLambert law computes correct exponential light transmittance', () => {
    // Transmittance should be 1.0 for zero density or zero step size
    const t0 = beerLambert(0.0, 1.0, 0.5);
    assert.equal(t0, 1.0, 'Zero density must yield 100% transmittance');

    const tZeroStep = beerLambert(10.0, 0.0, 0.5);
    assert.equal(tZeroStep, 1.0, 'Zero step size must yield 100% transmittance');

    // Expected value = exp(-0.5 * 2.0 * 1.5) = exp(-1.5) ≈ 0.22313
    const t = beerLambert(2.0, 1.5, 0.5);
    const expected = Math.exp(-0.5 * 2.0 * 1.5);
    assert.ok(Math.abs(t - expected) < 1e-5, `Expected ${expected}, got ${t}`);
  });

  it('henyeyGreenstein computes anisotropic Mie scattering phase function', () => {
    const g = 0.6; // Forward scattering parameter
    // Direct forward scattering (cosTheta = 1.0)
    const phaseForward = henyeyGreenstein(1.0, g);
    // Direct backscattering (cosTheta = -1.0)
    const phaseBackward = henyeyGreenstein(-1.0, g);

    // Forward scattering must be significantly stronger than backward scattering for positive g
    assert.ok(phaseForward > phaseBackward, 'Forward phase must exceed backward phase for positive g');

    // Analytical forward value: (1 - g^2) / (4 * PI * (1 - g)^3)
    const forwardExpected = (1.0 - g * g) / (4.0 * Math.PI * Math.pow(1.0 - g, 3));
    assert.ok(Math.abs(phaseForward - forwardExpected) < 1e-4, `Expected ${forwardExpected}, got ${phaseForward}`);
  });

  it('cloudDensityAt returns smooth volumetric density values bounded in [0, 1]', () => {
    // Sample inside normalized cloud layer [0, 1]
    const d1 = cloudDensityAt([0.2, 0.5, 0.1], 0.5, 0.0);
    assert.ok(d1 >= 0.0 && d1 <= 1.0, `Density must be between 0 and 1, got ${d1}`);

    // Boundary conditions: normalized altitude outside [0, 1] must yield 0 density
    const dBelow = cloudDensityAt([0.2, 0.5, 0.1], -0.1, 0.0);
    assert.equal(dBelow, 0.0, 'Below cloud layer base must have zero density');

    const dAbove = cloudDensityAt([0.2, 0.5, 0.1], 1.1, 0.0);
    assert.equal(dAbove, 0.0, 'Above cloud layer ceiling must have zero density');
  });
});
