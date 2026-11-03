import assert from 'node:assert/strict';
import test from 'node:test';
import { overlayScreenRect } from './image-overlay.ts';

test('georeferenced image corners project to a positive-width and positive-height rectangle', () => {
  const rect = overlayScreenRect(0.5, 0.5, 1000, 800, 600, { west: -80, east: -70, north: 45, south: 35 });
  assert.ok(rect.width > 0);
  assert.ok(rect.height > 0);
});

test('projected image rectangle moves opposite the camera pan', () => {
  const a = overlayScreenRect(0.5, 0.5, 1000, 800, 600, { west: -80, east: -70, north: 45, south: 35 });
  const b = overlayScreenRect(0.6, 0.6, 1000, 800, 600, { west: -80, east: -70, north: 45, south: 35 });
  assert.ok(b.x < a.x);
  assert.ok(b.y < a.y);
});
