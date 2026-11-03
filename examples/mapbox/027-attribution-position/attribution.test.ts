import assert from 'node:assert/strict';
import test from 'node:test';
import { attributionRect } from './attribution.ts';

test('attribution rectangle stays inside the selected corner with a fixed margin', () => {
  assert.deepEqual(attributionRect(800, 600, 'bottom-left'), { x: 12, y: 560, width: 222, height: 28 });
  assert.deepEqual(attributionRect(800, 600, 'top-right'), { x: 566, y: 12, width: 222, height: 28 });
});

test('all four attribution corners have matching horizontal and vertical alignment', () => {
  const rects = ['bottom-left', 'bottom-right', 'top-left', 'top-right'].map((corner) =>
    attributionRect(800, 600, corner as 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right'));
  assert.equal(new Set(rects.map((r) => r.x)).size, 2);
  assert.equal(new Set(rects.map((r) => r.y)).size, 2);
});
