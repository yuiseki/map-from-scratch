import assert from 'node:assert/strict';
import test from 'node:test';
import { baseLayerStyles } from './map.ts';

test('base-layer styles include distinct OSM and satellite palettes', () => {
  assert.deepEqual(Object.keys(baseLayerStyles).sort(), ['osm', 'satellite']);
  assert.notEqual(baseLayerStyles.osm.land, baseLayerStyles.satellite.land);
  assert.notEqual(baseLayerStyles.osm.ocean, baseLayerStyles.satellite.ocean);
  for (const style of Object.values(baseLayerStyles)) {
    for (const color of Object.values(style)) assert.match(color, /^#[0-9a-f]{6}$/i);
  }
});
