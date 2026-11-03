import test from 'node:test';
import assert from 'node:assert/strict';
import { generateUkCommuteFlows, buildCommuteArcMesh, UK_CENTER } from './commute.ts';

test('generateUkCommuteFlows produces realistic inter-city commute pairs', () => {
  const flows = generateUkCommuteFlows(120);
  assert.equal(flows.length, 120);

  for (const f of flows) {
    assert.ok(f.volume > 0 && f.volume <= 50000);
    assert.ok(f.fromLon > -5.5 && f.fromLon < 1.8, `fromLon=${f.fromLon} outside UK`);
    assert.ok(f.fromLat > 50.5 && f.fromLat < 55.5, `fromLat=${f.fromLat} outside UK`);
    assert.ok(f.toLon > -5.5 && f.toLon < 1.8, `toLon=${f.toLon} outside UK`);
    assert.ok(f.toLat > 50.5 && f.toLat < 55.5, `toLat=${f.toLat} outside UK`);
  }
});

test('buildCommuteArcMesh generates 3D parabolic curves with positive apex heights', () => {
  const flows = generateUkCommuteFlows(10);
  const mesh = buildCommuteArcMesh(flows, UK_CENTER);

  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length % 3, 0);
  assert.equal(mesh.colors.length, mesh.positions.length);

  // Check that apex vertices have positive z height
  let maxZ = 0;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    const z = mesh.positions[i];
    assert.ok(!Number.isNaN(z));
    if (z > maxZ) maxZ = z;
  }
  assert.ok(maxZ > 10000, `Expected apex z > 10000m, got ${maxZ}`);
});
