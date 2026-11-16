import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeQuarterMesh, scoreNeighborhood, type AccessFeature } from './utopia.ts';

test('decodes an e-Stat 250 m mesh code to the correct fifth-mesh dimensions', () => {
  const cell = decodeQuarterMesh('5339230714');
  assert.ok(Math.abs((cell.north - cell.south) - 7.5 / 3600) < 1e-10);
  assert.ok(Math.abs((cell.east - cell.west) - 11.25 / 3600) < 1e-10);
  assert.ok(cell.south < cell.north && cell.west < cell.east);
});

test('decodes a mesh in the Nerima Station area to its known geographic neighborhood', () => {
  const cell = decodeQuarterMesh('5339458231');
  assert.ok(Math.abs(cell.longitude - 139.6515625) < 1e-9);
  assert.ok(Math.abs(cell.latitude - 35.7385416667) < 1e-9);
});

test('rejects malformed mesh codes and invalid subdivision digits', () => {
  assert.throws(() => decodeQuarterMesh('533923071'), /10 digits/);
  assert.throws(() => decodeQuarterMesh('5339230705'), /subdivision/);
});

test('scores access independently for schools and public green spaces', () => {
  const center: [number, number] = [139.65, 35.74];
  const points: AccessFeature[] = [
    { kind: 'park', geometry: { type: 'Polygon', coordinates: [[[139.649, 35.739], [139.651, 35.739], [139.651, 35.741], [139.649, 35.741], [139.649, 35.739]]] } },
    { kind: 'school', geometry: { type: 'Point', coordinates: [139.66, 35.74] } },
  ];
  const score = scoreNeighborhood(center, points);
  assert.equal(score.nearestParkMeters, 0);
  assert.ok(score.nearestSchoolMeters > 800 && score.nearestSchoolMeters < 950);
  assert.equal(score.walkableToPark, true);
  assert.equal(score.walkableToSchool, false);
});

test('a park interior hole is not treated as accessible park area', () => {
  const score = scoreNeighborhood([139.65, 35.74], [{ kind: 'park', geometry: { type: 'Polygon', coordinates: [
    [[139.64, 35.73], [139.66, 35.73], [139.66, 35.75], [139.64, 35.75], [139.64, 35.73]],
    [[139.649, 35.739], [139.651, 35.739], [139.651, 35.741], [139.649, 35.741], [139.649, 35.739]],
  ] } }]);
  assert.ok(score.nearestParkMeters > 50);
});
