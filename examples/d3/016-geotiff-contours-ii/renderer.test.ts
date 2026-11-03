import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeTemperatureRaster } from './renderer.ts';

function fixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(12 + 720 * 361 * 2);
  const view = new DataView(buffer);
  view.setUint8(0, 71); view.setUint8(1, 84); view.setUint8(2, 48); view.setUint8(3, 49);
  view.setUint32(4, 720, true); view.setUint32(8, 361, true);
  new Uint16Array(buffer, 12).set([0, 10000, 20000]);
  return buffer;
}

test('GeoTIFF raster decoder validates dimensions and returns the packed temperature grid', () => {
  const pixels = decodeTemperatureRaster(fixture());
  assert.equal(pixels.length, 720 * 361);
  assert.deepEqual([...pixels.slice(0, 3)], [0, 10000, 20000]);
});

test('GeoTIFF raster decoder rejects a bad signature and a truncated grid', () => {
  const badHeader = fixture();
  new DataView(badHeader).setUint8(0, 0);
  assert.throws(() => decodeTemperatureRaster(badHeader), /invalid data header/);
  assert.throws(() => decodeTemperatureRaster(fixture().slice(0, -2)), /invalid raster dimensions/);
});
