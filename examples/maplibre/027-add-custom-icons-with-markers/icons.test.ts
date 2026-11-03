import assert from 'node:assert/strict';
import test from 'node:test';
import { MARKERS, markerWorldPosition } from './icons.ts';

test('custom marker catalog contains three named color variants at distinct map positions', () => {
  assert.deepEqual(MARKERS.map(({ name }) => name), ['green', 'orange', 'magenta']);
  assert.equal(new Set(MARKERS.map((m) => markerWorldPosition(m).join(','))).size, 3);
  for (const marker of MARKERS) {
    const [x, y] = markerWorldPosition(marker);
    assert.ok(x >= 0 && x <= 1);
    assert.ok(y > 0 && y < 1);
    assert.ok(marker.color.startsWith('#'));
  }
});
