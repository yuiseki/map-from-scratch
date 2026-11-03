import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCountySeries } from './contours.ts';

function fixture(): ArrayBuffer {
  const buffer = new ArrayBuffer(27);
  const view = new DataView(buffer);
  view.setUint32(0, 0x31305443, true);
  view.setUint32(4, 1, true);
  view.setUint32(8, 2, true);
  view.setFloat32(12, 100, true);
  view.setFloat32(16, 0.25, true);
  view.setFloat32(20, 0.75, true);
  view.setUint8(24, 0xbc);
  view.setUint8(25, 0xfa);
  view.setUint8(26, 0xde);
  return buffer;
}

test('county series decoder restores the header, normalized position and packed 12-bit rates', () => {
  const decoded = decodeCountySeries(fixture());
  assert.equal(decoded.weeks, 2);
  assert.equal(decoded.rateLimit, 100);
  assert.deepEqual(decoded.counties[0], { x: 0.25, y: 0.75, rates: new Uint16Array([0xabc, 0xdef]) });
});

test('county series decoder rejects an invalid signature and truncated records', () => {
  const badMagic = fixture();
  new DataView(badMagic).setUint32(0, 0, true);
  assert.throws(() => decodeCountySeries(badMagic), /invalid county data/);
  assert.throws(() => decodeCountySeries(fixture().slice(0, 26)), /truncated county data/);
});
