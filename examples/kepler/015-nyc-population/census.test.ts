import test from 'node:test';
import assert from 'node:assert/strict';
import { generateNycCensusTracts, buildCensusMesh, getPopulationColor, CENSUS_CENTER } from './census.ts';

test('generateNycCensusTracts creates non-empty tracts with population counts', () => {
  const tracts = generateNycCensusTracts();
  assert.ok(tracts.length > 50, `Expected >50 tracts, got ${tracts.length}`);

  for (const t of tracts) {
    assert.ok(t.population >= 100 && t.population <= 25000);
    assert.ok(t.coordinates.length >= 4);
  }
});

test('getPopulationColor maps population to valid RGB triplets', () => {
  const lowColor = getPopulationColor(500);
  const midColor = getPopulationColor(5000);
  const highColor = getPopulationColor(16000);

  assert.equal(lowColor.length, 3);
  assert.equal(midColor.length, 3);
  assert.equal(highColor.length, 3);

  // Low is deep violet/indigo, high is radiant yellow (high red & green)
  assert.ok(highColor[0] > lowColor[0] + 0.3);
  assert.ok(highColor[1] > lowColor[1] + 0.5);
});

test('buildCensusMesh builds valid 3D extruded pillar buffers', () => {
  const tracts = generateNycCensusTracts().slice(0, 10);
  const mesh = buildCensusMesh(tracts, CENSUS_CENTER);

  assert.ok(mesh.positions.length > 0);
  assert.equal(mesh.positions.length % 3, 0);
  assert.equal(mesh.normals.length, mesh.positions.length);
  assert.equal(mesh.colors.length, mesh.positions.length);

  for (let i = 0; i < mesh.positions.length; i++) {
    assert.ok(!Number.isNaN(mesh.positions[i]), `NaN at position ${i}`);
  }
});
