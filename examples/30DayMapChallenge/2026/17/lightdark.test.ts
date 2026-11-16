import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findMeshAt,
  directionalNeighbor,
  localProjection,
  meshAtScreenPoint,
  populationIntensity,
  sharedMaximum,
  validatePresenceMap,
  type PresenceMap,
} from './lightdark.ts';

const fixture: PresenceMap = {
  bounds: { west: 139.5, east: 140, south: 35.5, north: 36 },
  year: 2021,
  month: 12,
  dayflag: '2',
  maximum: 120,
  meshes: [
    { id: 'A', west: 139.5, east: 139.6, south: 35.5, north: 35.6, daytime: 120, lateNight: null },
    { id: 'B', west: 139.6, east: 139.7, south: 35.5, north: 35.6, daytime: 30, lateNight: 10 },
  ],
};

test('the daytime and late-night views share one population scale', () => {
  assert.equal(sharedMaximum(fixture), 120);
  assert.equal(populationIntensity(120, sharedMaximum(fixture)), 1);
  assert.ok(populationIntensity(30, sharedMaximum(fixture))! < populationIntensity(120, sharedMaximum(fixture))!);
  assert.equal(populationIntensity(null, 120), null);
  assert.ok(populationIntensity(1.5, 120)! > 0); // Legend gradients interpolate continuous values; data validation rejects these as records.
});

test('the local projection keeps ground aspect and maps north upward', () => {
  const projection = localProjection(fixture.bounds, 0, 0, 500, 500);
  const west = projection(139.5, 35.75);
  const east = projection(139.6, 35.75);
  const north = projection(139.5, 35.85);
  assert.ok(east.x > west.x);
  assert.ok(north.y < west.y);
  const eastDiff = east.x - west.x;
  const northDiff = west.y - north.y;
  assert.ok(Math.abs(eastDiff / northDiff - Math.cos(35.75 * Math.PI / 180)) < 0.01);
});

test('a selected cell keeps the two published counts paired and missing stays unknown', () => {
  const selected = findMeshAt(fixture, 139.55, 35.55);
  assert.deepEqual(selected, fixture.meshes[0]);
  assert.equal(selected?.daytime, 120);
  assert.equal(selected?.lateNight, null);
  assert.equal(findMeshAt(fixture, 140, 36), null);
});

test('the same screen selection resolves to one shared mesh in both map panels', () => {
  const project = localProjection(fixture.bounds, 10, 10, 500, 500);
  const cell = fixture.meshes[1]!;
  const center = project((cell.west + cell.east) / 2, (cell.south + cell.north) / 2);
  assert.equal(meshAtScreenPoint(fixture, project, center.x, center.y)?.id, 'B');
  assert.equal(meshAtScreenPoint(fixture, project, 9, 9), null);
});

test('keyboard directions move to the nearest mesh in that direction', () => {
  assert.equal(directionalNeighbor(fixture, 'A', 'right')?.id, 'B');
  assert.equal(directionalNeighbor(fixture, 'B', 'left')?.id, 'A');
  assert.equal(directionalNeighbor(fixture, 'A', 'left')?.id, 'A');
});

test('presence map validation rejects duplicate cells, invalid values, and a false scale', () => {
  assert.doesNotThrow(() => validatePresenceMap(fixture));
  assert.throws(() => validatePresenceMap({ ...fixture, meshes: [...fixture.meshes, fixture.meshes[0]!] }), /duplicate/);
  assert.throws(() => validatePresenceMap({ ...fixture, meshes: [{ ...fixture.meshes[0]!, lateNight: 1.5 }] }), /population/);
  assert.throws(() => validatePresenceMap({ ...fixture, maximum: 100 }), /maximum/);
});
