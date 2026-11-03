import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRoadData } from './road-data.ts';

function roads(): ArrayBuffer {
  const buffer = new ArrayBuffer(48);
  const view = new DataView(buffer);
  for (const [i, c] of [...'VPRD'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint16(4, 1, true); view.setUint32(6, 2, true); view.setUint32(10, 2, true); view.setUint32(14, 1, true);
  new Uint32Array(buffer, 32, 4).set([1, 2, 3, 4]);
  return buffer;
}

test('vertex-pulled roads parser reads the counts and packed node buffer', () => {
  const parsed = parseRoadData(roads());
  assert.equal(parsed.roadCount, 2);
  assert.equal(parsed.nodeCount, 2);
  assert.equal(parsed.segmentCount, 1);
  assert.deepEqual([...parsed.nodes], [1, 2, 3, 4]);
});

test('vertex-pulled roads parser rejects bad magic and truncated nodes', () => {
  const bad = roads(); new Uint8Array(bad, 0, 4).set([0, 0, 0, 0]);
  assert.throws(() => parseRoadData(bad), /Invalid magic/);
  assert.throws(() => parseRoadData(roads().slice(0, 47)), /truncated road nodes/);
});
