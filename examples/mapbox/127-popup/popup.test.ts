import assert from 'node:assert/strict';
import test from 'node:test';
import { mapboxPopupBoundsAt } from './popup.ts';

test('Mapbox popup aligns its center and bottom tip to the anchor', () => {
  const bounds = mapboxPopupBoundsAt(300, 200);
  assert.equal(bounds.x + bounds.width / 2, 300);
  assert.equal(bounds.y + bounds.height + 10, 200);
  assert.ok(bounds.closeBtn.x >= bounds.x && bounds.closeBtn.x + bounds.closeBtn.size <= bounds.x + bounds.width);
});
