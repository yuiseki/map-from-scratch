import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeMercator,
  globePosition,
  populationRadius,
  populationTone,
  validateHexCells,
  type HexCell,
} from './globe.ts';

const sample: HexCell = {
  h3: '8428309ffffffff', population: 100,
  polygons: [[[-122.5, 37.5], [-122.4, 37.5], [-122.45, 37.6]]],
};

test('decodes Web Mercator coordinates into longitude and latitude', () => {
  const origin = decodeMercator(0, 0);
  assert.ok(Math.abs(origin[0]) < 1e-10);
  assert.ok(Math.abs(origin[1]) < 1e-10);
  const east = decodeMercator(20_037_508.342789244, 0);
  assert.ok(Math.abs(east[0] - 180) < 1e-6);
  const north45 = decodeMercator(0, 5_621_521.486192066);
  assert.ok(Math.abs(north45[1] - 45) < 1e-5);
});

test('projects longitude and latitude to a unit globe vertex', () => {
  const equatorPrime = globePosition(0, 0, 1);
  assert.deepEqual(equatorPrime.map((value) => Math.round(value * 1e6) / 1e6), [1, 0, 0]);
  const northPole = globePosition(0, 90, 1);
  assert.ok(Math.abs(northPole[1] - 1) < 1e-10);
  const antimeridian = globePosition(180, 0, 1);
  assert.ok(Math.abs(antimeridian[0] + 1) < 1e-10);
});

test('keeps antimeridian-neighbor vertices close on the sphere', () => {
  const west = globePosition(179.9, 10, 1);
  const east = globePosition(-179.9, 10, 1);
  const chord = Math.hypot(west[0] - east[0], west[1] - east[1], west[2] - east[2]);
  assert.ok(chord < 0.004, `antimeridian chord ${chord} must be local, not world-spanning`);
});

test('population color and radial height are monotone and preserve zero', () => {
  assert.deepEqual(populationTone(0), [29, 43, 55]);
  assert.ok(populationTone(1)[0] > populationTone(0)[0]);
  assert.ok(populationTone(1_000)[0] > populationTone(1)[0]);
  assert.ok(populationRadius(10_000) > populationRadius(10));
  assert.ok(populationRadius(22_732_635) > populationRadius(1));
});

test('rejects malformed cell records and accepts valid H3 polygons', () => {
  assert.doesNotThrow(() => validateHexCells([sample]));
  assert.throws(() => validateHexCells([{ ...sample, population: -1 }]), /population/i);
  assert.throws(() => validateHexCells([{ ...sample, h3: '' }]), /H3/i);
  assert.throws(() => validateHexCells([{ ...sample, polygons: [[[-122, 37], [NaN, 38], [-121, 39]]] }]), /coordinate/i);
});
