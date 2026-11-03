import assert from 'node:assert/strict';
import test from 'node:test';
import { invMercY, mercX, mercY, STYLES } from './tiles.ts';

test('tile source projection round-trips ordinary geographic coordinates', () => {
  assert.equal(mercX(0), 0.5);
  assert.equal(mercY(0), 0.5);
  for (const lat of [-75, -45, 0, 35.6812, 60, 75]) assert.ok(Math.abs(invMercY(mercY(lat)) - lat) < 1e-9);
});

test('raster source selector exposes three uniquely named tile styles', () => {
  assert.equal(STYLES.length, 3);
  assert.equal(new Set(STYLES.map(({ id }) => id)).size, STYLES.length);
  assert.ok(STYLES.every(({ url }) => url.startsWith('https://')));
});
