import assert from 'node:assert/strict';
import test from 'node:test';
import { ICONS, iconHitTest } from './map.ts';

test('custom icon set has distinct ids, supported shapes and separate map locations', () => {
  assert.equal(new Set(ICONS.map((icon) => icon.id)).size, ICONS.length);
  assert.deepEqual(new Set(ICONS.map((icon) => icon.kind)), new Set(['pin', 'square', 'circle']));
  assert.equal(new Set(ICONS.map((icon) => `${icon.lat},${icon.lng}`)).size, ICONS.length);
});

test('icon hit test applies the configured circular tolerance around the raised icon center', () => {
  assert.equal(iconHitTest(0, 0), true);
  assert.equal(iconHitTest(18, 0), true);
  assert.equal(iconHitTest(18.01, 0), false);
  assert.equal(iconHitTest(0, 18.01), false);
});
