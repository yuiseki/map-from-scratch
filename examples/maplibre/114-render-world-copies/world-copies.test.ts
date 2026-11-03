import assert from 'node:assert/strict';
import test from 'node:test';
import { worldPixelWidth } from './world-copies.ts';

test('world pixel width doubles for each zoom level', () => {
  assert.equal(worldPixelWidth(0), 256);
  assert.equal(worldPixelWidth(1), 512);
  assert.equal(worldPixelWidth(3), 2048);
});

test('fractional zoom produces a continuous world width', () => {
  assert.ok(Math.abs(worldPixelWidth(0.5) - 256 * Math.sqrt(2)) < 1e-10);
});
