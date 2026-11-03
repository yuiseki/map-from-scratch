import assert from 'node:assert/strict';
import test from 'node:test';
import { classAt, groundAt, heightAt, parseRelief, uvOf, worldOf } from './terrain.ts';

function swissBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(32 + 4 * 2 + 4);
  const view = new DataView(buffer);
  for (const [i, c] of [...'SWLC'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint16(6, 2, true); view.setUint16(8, 2, true);
  view.setUint16(10, 400, true); view.setUint16(12, 1800, true);
  view.setFloat32(14, 100, true);
  view.setUint32(18, 131073, true); view.setUint32(22, 131271, true);
  view.setUint16(26, 10, true);
  new Uint16Array(buffer, 32, 4).set([10, 20, 30, 40]);
  new Uint8Array(buffer, 40, 4).set([1, 2, 3, 4]);
  return buffer;
}

test('Swiss relief parser restores elevations, classes and raster metadata', () => {
  const relief = parseRelief(swissBuffer());
  assert.equal(relief.width, 2);
  assert.equal(relief.minElev, 400);
  assert.equal(relief.maxElev, 1800);
  assert.deepEqual([...relief.heights], [10, 20, 30, 40]);
  assert.deepEqual([...relief.classes], [1, 2, 3, 4]);
  assert.deepEqual(uvOf(relief, 0, 0), [-0.5, -99.5]);
});

test('Swiss raster lookup clamps elevation, bounds class lookup and applies vertical scale', () => {
  const relief = parseRelief(swissBuffer());
  assert.equal(heightAt(relief, 0.5, 0.5), 25);
  assert.equal(classAt(relief, 0.75, 0.75), 4);
  assert.equal(classAt(relief, -0.1, 0.5), 0);
  assert.deepEqual(worldOf(relief, 0.5, 0.5), [0, 0, 62.5]);
  assert.equal(groundAt(relief, 1000, 0), 0);
});

test('Swiss relief parser rejects a non-SWLC buffer', () => {
  const buffer = swissBuffer();
  new Uint8Array(buffer, 0, 4).set([0, 0, 0, 0]);
  assert.throws(() => parseRelief(buffer), /bad magic/);
});
