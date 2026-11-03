import assert from 'node:assert/strict';
import test from 'node:test';
import { clickPopupBoundsAt } from './popup.ts';

test('click popup is centered above the clicked map point', () => {
  const bounds = clickPopupBoundsAt(300, 250);
  assert.deepEqual([bounds.x, bounds.y, bounds.width, bounds.height], [220, 196, 160, 44]);
  assert.ok(bounds.closeBtn.x + bounds.closeBtn.size <= bounds.x + bounds.width);
});
