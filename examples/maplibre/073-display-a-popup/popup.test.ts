import assert from 'node:assert/strict';
import test from 'node:test';
import { popupBoundsAt } from './popup.ts';

test('general popup is centered above its selected coordinate', () => {
  const bounds = popupBoundsAt(80, 90);
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [10, 36, 140, 44]);
  assert.ok(bounds.closeBtn.x >= bounds.x && bounds.closeBtn.x + bounds.closeBtn.size <= bounds.x + bounds.width);
});
