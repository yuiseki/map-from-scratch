import assert from 'node:assert/strict';
import test from 'node:test';
import { fatalityRateBucket } from './renderer.ts';

test('fatality-rate bucket advances at each configured threshold', () => {
  assert.equal(fatalityRateBucket(0), 1);
  assert.equal(fatalityRateBucket(3.99), 1);
  assert.equal(fatalityRateBucket(4), 2);
  assert.equal(fatalityRateBucket(8), 3);
});

test('fatality-rate bucket caps the shader category at its last supported value', () => {
  assert.equal(fatalityRateBucket(220), 9);
  assert.equal(fatalityRateBucket(1000), 9);
});
