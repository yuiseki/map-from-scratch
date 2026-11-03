import assert from 'node:assert/strict';
import test from 'node:test';
import { parsePointCloud } from './point-cloud-data.ts';

function pointCloudBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(40);
  const view = new DataView(buffer);
  for (const [i, c] of [...'PC01'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint32(4, 2, true);
  [-1, 0, 2, 3, 4, 6].forEach((n, i) => view.setFloat32(8 + i * 4, n, true));
  new Uint32Array(buffer, 32, 2).set([0x12345678, 0xabcdef01]);
  return buffer;
}

test('point cloud parser reads normalized bounds and retains packed point records', () => {
  const cloud = parsePointCloud(pointCloudBuffer());
  assert.equal(cloud.count, 2);
  assert.deepEqual(cloud.lo, [-2, -2, -2]);
  assert.deepEqual(cloud.span, [4, 4, 4]);
  assert.deepEqual([...cloud.points], [0x12345678, 0xabcdef01]);
});

test('point cloud parser rejects invalid signatures and inconsistent payload lengths', () => {
  const badMagic = pointCloudBuffer(); new Uint8Array(badMagic, 0, 4).set([0, 0, 0, 0]);
  assert.throws(() => parsePointCloud(badMagic), /invalid point-cloud header/);
  assert.throws(() => parsePointCloud(pointCloudBuffer().slice(0, 39)), /invalid point-cloud length/);
});
