import test from 'node:test';
import assert from 'node:assert/strict';
import { mercX, mercY, lonOfX, latOfY, tileBounds, encodeHeight, decodeHeight, HEIGHT_STEP, decodeTerrarium, heightsFromRGBA } from './tiles.ts';

test('mercator x/y round-trip and match known tile corners', () => {
  // z9 tile x=454 starts at 139.21875 E (454 / 512 * 360 - 180).
  assert.ok(Math.abs(lonOfX(454 / 512) - 139.21875) < 1e-12);
  assert.ok(Math.abs(mercX(139.21875) - 454 / 512) < 1e-12);
  for (const lat of [-80, -35.5, 0, 39.7, 85]) assert.ok(Math.abs(latOfY(mercY(lat)) - lat) < 1e-9, `lat ${lat}`);
  // North is up: a larger latitude has a smaller y.
  assert.ok(mercY(40) < mercY(39));
  assert.equal(mercY(0), 0.5);
});

test('tileBounds gives the west/north/east/south of a tile from z/x/y', () => {
  const [w, n, e, s] = tileBounds(9, 454, 190);
  assert.ok(Math.abs(w - 139.21875) < 1e-9 && Math.abs(e - 139.921875) < 1e-9);
  assert.ok(n > s, 'north above south');
  assert.ok(Math.abs(n - latOfY(190 / 512)) < 1e-12);
});

test('heights survive the two-byte encoding to within half a step, sea stays at 0', () => {
  for (const h of [0, 0.3, 12.75, 2236.4, 8848, -420]) {
    const [r, g] = encodeHeight(h);
    assert.ok(r >= 0 && r < 256 && g >= 0 && g < 256);
    assert.ok(Math.abs(decodeHeight(r, g) - h) <= HEIGHT_STEP / 2 + 1e-9, `h ${h} -> ${decodeHeight(r, g)}`);
  }
  const [r0, g0] = encodeHeight(0);
  assert.equal(decodeHeight(r0, g0), 0, 'sea is exactly 0 m');
});

test('Terrarium decoding (Mapterhorn) is R*256 + G + B/256 - 32768', () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(136, 188, 128), 2236.5);
});

test('heightsFromRGBA reads every pixel of an RGBA image into metres', () => {
  const rgba = new Uint8ClampedArray(2 * 4);
  rgba.set([...encodeHeight(100), 0, 255, ...encodeHeight(1500.5), 0, 255]);
  const h = heightsFromRGBA(rgba, 2, 1);
  assert.equal(h.length, 2);
  assert.ok(Math.abs(h[0] - 100) < 0.2 && Math.abs(h[1] - 1500.5) < 0.2);
});
