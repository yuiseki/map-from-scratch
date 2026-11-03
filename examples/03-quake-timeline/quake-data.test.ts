import assert from 'node:assert/strict';
import test from 'node:test';
import { depthByte, magnitudeByte, quakeMinutes } from './quake-data.ts';

test('earthquake timestamps are encoded as minutes from the playback epoch', () => {
  assert.equal(quakeMinutes(Date.UTC(2025, 0, 1, 1), Date.UTC(2025, 0, 1)), 60);
  assert.equal(quakeMinutes(Date.UTC(2024, 11, 31, 23, 30), Date.UTC(2025, 0, 1)), -30);
});

test('magnitude and depth use rounded, byte-clamped encodings', () => {
  assert.equal(magnitudeByte(4), 0);
  assert.equal(magnitudeByte(5.26), 13);
  assert.equal(magnitudeByte(40), 255);
  assert.equal(depthByte(-1), 0);
  assert.equal(depthByte(7.5), 3);
  assert.equal(depthByte(1000), 255);
});
