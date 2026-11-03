import assert from 'node:assert/strict';
import test from 'node:test';
import { ROAD_DRAW_ORDER, ROAD_STYLE } from './map.ts';

test('road filter styles cover each route class with draw order from local to major', () => {
  assert.deepEqual(ROAD_DRAW_ORDER, ['SR', 'US', 'I']);
  assert.deepEqual(Object.keys(ROAD_STYLE).sort(), ['I', 'SR', 'US']);
  assert.ok(ROAD_DRAW_ORDER.every((type) => ROAD_STYLE[type].width > 0 && /^#[0-9a-f]{6}$/i.test(ROAD_STYLE[type].color)));
});
