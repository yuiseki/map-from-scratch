import assert from 'node:assert/strict';
import test from 'node:test';
import { fitScale, initialView, panBy, screenPoint, zoomAt, type Viewport } from './camera.ts';

test('the opening view fits the whole generated map inside the viewport', () => {
  const viewport: Viewport = { width: 1280, height: 800, imageWidth: 1536, imageHeight: 1024 };
  const view = initialView();
  const scale = fitScale(viewport) * view.zoom;
  assert.equal(scale, 0.78125);
  const topLeft = screenPoint(0, 0, viewport, view);
  const bottomRight = screenPoint(viewport.imageWidth, viewport.imageHeight, viewport, view);
  assert.ok(topLeft[0] >= 0 && topLeft[1] >= 0);
  assert.ok(bottomRight[0] <= viewport.width && bottomRight[1] <= viewport.height);
});

test('zooming keeps the image point beneath the pointer fixed', () => {
  const viewport: Viewport = { width: 1280, height: 800, imageWidth: 1536, imageHeight: 1024 };
  const before = initialView();
  const anchor: [number, number] = [930, 215];
  const imagePoint = [
    (anchor[0] - viewport.width / 2 - before.panX) / fitScale(viewport) + viewport.imageWidth / 2,
    (anchor[1] - viewport.height / 2 - before.panY) / fitScale(viewport) + viewport.imageHeight / 2,
  ];
  const after = zoomAt(before, 2.5, anchor[0], anchor[1], viewport);
  const moved = screenPoint(imagePoint[0], imagePoint[1], viewport, after);
  assert.ok(Math.abs(moved[0] - anchor[0]) < 1e-9);
  assert.ok(Math.abs(moved[1] - anchor[1]) < 1e-9);
  assert.equal(after.zoom, 2.5);
});

test('zoom stays bounded and a drag translates the map in the pointer direction', () => {
  const viewport: Viewport = { width: 1280, height: 800, imageWidth: 1536, imageHeight: 1024 };
  const start = initialView();
  const dragged = panBy(start, 42, -17);
  assert.deepEqual([dragged.panX, dragged.panY], [42, -17]);
  assert.equal(zoomAt(dragged, 0.001, 20, 20, viewport).zoom, 1);
  assert.equal(zoomAt(dragged, 100, 20, 20, viewport).zoom, 12);
});
