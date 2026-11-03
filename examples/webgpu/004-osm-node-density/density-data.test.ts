import assert from 'node:assert/strict';
import test from 'node:test';
import { decodePackedDensity } from './density-data.ts';

function deltaBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(40 + 3 * 4);
  const view = new DataView(buffer);
  view.setUint32(0, 3, true);
  new Uint16Array(buffer, 40, 3).set([1, 2, 3]);
  new Uint16Array(buffer, 46, 3).set([4, 5, 6]);
  return buffer;
}

test('WebGPU density points cumulatively decode deltas and pack y above x', () => {
  const decoded = decodePackedDensity(deltaBuffer(), 2);
  assert.deepEqual([...decoded.points], [0x00040001, 0x000f0006, 0x00090003]);
  assert.equal(decoded.count, 3);
});
