import assert from 'node:assert/strict';
import test from 'node:test';
import { morton, POP_MAX, radius10, R_MAX, R_MIN } from './city-encoding.ts';

test('population marker radius has a floor and scales with square root of population', () => {
  assert.equal(radius10(-1), R_MIN * 10);
  assert.equal(radius10(0), R_MIN * 10);
  assert.equal(radius10(POP_MAX), R_MAX * 10);
  assert.equal(radius10(POP_MAX / 4), R_MAX * 5);
});

test('Morton keys interleave coordinates and preserve unique cell locations', () => {
  assert.equal(morton(0, 0), 0n);
  assert.equal(morton(1, 0), 1n);
  assert.equal(morton(0, 1), 2n);
  assert.equal(morton(1, 1), 3n);
  assert.notEqual(morton(1234, 4321), morton(4321, 1234));
});
