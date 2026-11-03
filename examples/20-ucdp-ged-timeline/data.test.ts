import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode } from './data.ts';

function record(): ArrayBuffer {
  const bytes = new Uint8Array(26);
  bytes.set([71, 69, 68, 49]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint16(8, 1234, true); view.setUint16(10, 5678, true);
  view.setUint32(12, 34567, true); view.setUint32(16, 0x12345678, true);
  view.setUint16(20, 901, true); view.setUint8(22, 3); view.setUint8(23, 2); view.setUint16(24, 0x4567, true);
  return bytes.buffer;
}

test('GED1 decoder reads little-endian event fields in the fixed 18-byte record', () => {
  assert.deepEqual(decode(record()), [{ x: 1234, y: 5678, deaths: 34567, id: 0x12345678, day: 901, type: 3, precision: 2, country: 0x4567 }]);
});

test('GED1 decoder accepts an empty data set and rejects bad signatures or lengths', () => {
  const empty = new Uint8Array(8); empty.set([71, 69, 68, 49]);
  assert.deepEqual(decode(empty.buffer), []);
  const badMagic = record().slice(0); new Uint8Array(badMagic)[0] = 0;
  assert.throws(() => decode(badMagic), /version mismatch/);
  assert.throws(() => decode(record().slice(0, 25)), /size mismatch/);
});
