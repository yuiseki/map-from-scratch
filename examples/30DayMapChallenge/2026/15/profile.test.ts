import assert from 'node:assert/strict';
import test from 'node:test';
import { flipReliefY, depthSectionY, sampleIndex, sectionDistanceKm, validateProfile, type ProfileData } from './profile.ts';

test('inside-out relief mirrors elevation around mean sea level', () => {
  assert.equal(flipReliefY(1000, 300, 0.1), 400);
  assert.equal(flipReliefY(-2000, 300, 0.1), 100);
  assert.equal(flipReliefY(0, 300, 0.1), 300);
});

test('hypocenter depths increase downward on their separate catalog axis', () => {
  assert.equal(depthSectionY(0, 300, 0.4), 300);
  assert.equal(depthSectionY(25, 300, 0.4), 310);
  assert.throws(() => depthSectionY(-1, 300, 0.4), /depth/);
});

test('sample index preserves endpoints and maps interior samples deterministically', () => {
  assert.equal(sampleIndex(0, 720, 240), 0);
  assert.equal(sampleIndex(239, 720, 240), 719);
  assert.equal(sampleIndex(120, 720, 240), 361);
});

test('distance axis uses local east-west ground distance at the transect latitude', () => {
  assert.ok(Math.abs(sectionDistanceKm(143, 146, 43.25) - 243.4) < 0.5);
});

test('profile validation rejects malformed source elevations and hypocenter coordinates', () => {
  const valid: ProfileData = { west: 143, east: 146, latitude: 42.25, elevations: [-100, 0, 100], events: [{ lon: 144, depthKm: 12, magnitude: 4.8, id: 'us123' }] };
  assert.doesNotThrow(() => validateProfile(valid));
  assert.throws(() => validateProfile({ ...valid, elevations: [-100, Number.NaN, 100] }), /elevations/);
  assert.throws(() => validateProfile({ ...valid, events: [{ ...valid.events[0]!, depthKm: -2 }] }), /hypocenter/);
});
