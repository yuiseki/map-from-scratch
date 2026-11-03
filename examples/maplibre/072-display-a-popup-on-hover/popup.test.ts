import assert from 'node:assert/strict';
import test from 'node:test';
import { hoverPopupBoundsAt } from './popup.ts';

test('hover popup is centered above the fixed marker', () => {
  assert.deepEqual(hoverPopupBoundsAt(400, 300), { x: 330, y: 252, width: 140, height: 40 });
});
