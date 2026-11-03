import assert from 'node:assert/strict';
import test from 'node:test';
import { STYLES } from './map.ts';
test('custom map styles provide complete and distinct color palettes', () => {
  assert.ok(Object.keys(STYLES).length >= 2);
  for (const style of Object.values(STYLES)) {
    for (const color of [style.ocean, style.land, style.border]) {
      assert.equal(color.length, 4);
      assert.ok(color.every((channel) => channel >= 0 && channel <= 1));
      assert.equal(color[3], 1);
    }
  }
  assert.ok(new Set(Object.values(STYLES).map((style) => style.ocean.join(','))).size > 1);
});
