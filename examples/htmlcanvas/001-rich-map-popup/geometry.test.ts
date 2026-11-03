import assert from 'node:assert/strict';
import test from 'node:test';
import { popupRectAtAnchor, projectWorld, unprojectWorld } from './geometry.ts';

test('HTML popup map projection and unprojection invert at a Mercator camera center', () => {
  const worldSize = 512 * 2 ** 14;
  const center = { x: 0.888 * worldSize, y: 0.394 * worldSize };
  const screen = projectWorld(center.x, center.y, center.x, center.y, 800, 600);
  assert.deepEqual(screen, { x: 400, y: 300 });
  const point = unprojectWorld(screen.x + 64, screen.y - 32, center.x, center.y, 800, 600, worldSize);
  const mx = ((point.lon + 180) / 360) * worldSize;
  const my = ((1 - Math.asinh(Math.tan((point.lat * Math.PI) / 180)) / Math.PI) / 2) * worldSize;
  const again = projectWorld(mx, my, center.x, center.y, 800, 600);
  assert.ok(Math.abs(again.x - 464) < 1e-9 && Math.abs(again.y - 268) < 1e-9);
});

test('HTML popup rectangle is centered over its anchor with the fixed gap', () => {
  assert.deepEqual(popupRectAtAnchor(200, 180, 260, 140), { x: 70, y: 26, width: 260, height: 140 });
});
