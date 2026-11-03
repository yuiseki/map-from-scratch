import assert from 'node:assert/strict';
import test from 'node:test';
import { markerPopupBoundsAt } from './marker-popup.ts';

test('marker popup is centered above its anchor with the close button inside', () => {
  const bounds = markerPopupBoundsAt(200, 180);
  assert.equal(bounds.x + bounds.width / 2, 200);
  assert.equal(bounds.y + bounds.height + 35, 180);
  assert.ok(bounds.closeBtn.x >= bounds.x && bounds.closeBtn.x + bounds.closeBtn.size <= bounds.x + bounds.width);
});
