import assert from 'node:assert/strict';
import test from 'node:test';
import { labelScreenRect } from './geometry.ts';

test('WebGPU label rectangle is horizontally centered above the map anchor', () => {
  assert.deepEqual(labelScreenRect(0.5, 0.5, 0.5, 0.5, 12, 800, 600), {
    x: 325, y: 228, width: 150, height: 60,
  });
});

test('WebGPU label position follows Mercator scale and camera movement', () => {
  const rect = labelScreenRect(0.5001, 0.4999, 0.5, 0.5, 10, 800, 600);
  assert.deepEqual(rect, { x: 351, y: 202, width: 150, height: 60 });
});
