import assert from 'node:assert/strict';
import test from 'node:test';
import { parseTileRings } from './tile-data.ts';

function ringBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  view.setUint16(0, 1, true); view.setUint16(2, 2, true);
  view.setUint16(4, 0, true); view.setUint16(6, 4096, true);
  view.setUint16(8, 2048, true); view.setUint16(10, 1024, true);
  return buffer;
}

test('WASM tile payload decoder converts local integer coordinates into normalized rings', () => {
  const [ring] = parseTileRings(ringBuffer());
  assert.deepEqual([...ring], [0, 1, 0.5, 0.25]);
});

test('WASM tile payload decoder rejects incomplete ring and point records', () => {
  assert.throws(() => parseTileRings(ringBuffer().slice(0, 3)), /truncated tile ring header/);
  assert.throws(() => parseTileRings(ringBuffer().slice(0, 10)), /truncated tile ring points/);
});
