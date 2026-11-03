import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSubgroupPoints } from './point-data.ts';

function points(): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  view.setUint32(0, 0x47535542, true); view.setUint32(4, 1, true);
  [1, 2, 3, 4].forEach((n, i) => view.setFloat64(8 + i * 8, n, true));
  new Uint32Array(buffer, 40, 1).set([0x12345678]);
  return buffer;
}

test('subgroup density parser returns its float64 bounds and packed point words', () => {
  const parsed = parseSubgroupPoints(points());
  assert.equal(parsed.count, 1);
  assert.deepEqual(parsed.bounds, [1, 2, 3, 4]);
  assert.deepEqual([...parsed.points], [0x78, 0x56, 0x34, 0x12]);
});

test('subgroup density parser rejects invalid signatures and point lengths', () => {
  const bad = points(); new DataView(bad).setUint32(0, 0, true);
  assert.throws(() => parseSubgroupPoints(bad), /Invalid magic/);
  assert.throws(() => parseSubgroupPoints(points().slice(0, 43)), /truncated subgroup points/);
});
