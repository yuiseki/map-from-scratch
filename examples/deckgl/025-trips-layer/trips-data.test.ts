import assert from 'node:assert/strict';
import test from 'node:test';
import { parseBuildingBuffer, parseTripsBuffer } from './trips-data.ts';

function tripsBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(42);
  const view = new DataView(buffer);
  view.setUint32(0, 0x33305054, true); view.setUint32(4, 1, true); view.setUint32(8, 7, true);
  [10, 20, 30, 40].forEach((n, i) => view.setFloat32(12 + i * 4, n, true));
  view.setUint32(28, 6, true);
  return buffer;
}

function buildingBuffer(indices = [0, 2, 2]): ArrayBuffer {
  const buffer = new ArrayBuffer(32 + 3 * 8 + indices.length);
  const view = new DataView(buffer);
  view.setUint32(0, 0x33304442, true); view.setUint32(4, 3, true); view.setUint32(8, indices.length, true);
  [1, 2, 3, 4].forEach((n, i) => view.setFloat32(12 + i * 4, n, true));
  view.setUint32(28, 5, true);
  new Uint8Array(buffer, 56).set(indices);
  return buffer;
}

test('trips parser reads record count, object count, segment count and bounds', () => {
  assert.deepEqual(parseTripsBuffer(tripsBuffer(), 0x33305054, 10), {
    buffer: tripsBuffer(), count: 1, objects: 7, segments: 6, bounds: [10, 20, 30, 40],
  });
});

test('building parser decodes delta-zigzag indices and metadata', () => {
  const parsed = parseBuildingBuffer(buildingBuffer());
  assert.equal(parsed.count, 3);
  assert.deepEqual([...parsed.indices], [0, 1, 2]);
  assert.equal(parsed.objects, 5);
  assert.deepEqual(parsed.bounds, [1, 2, 3, 4]);
});

test('trip and building parsers reject malformed binary buffers', () => {
  const wrong = tripsBuffer(); new DataView(wrong).setUint32(0, 0, true);
  assert.throws(() => parseTripsBuffer(wrong, 0x33305054, 10), /invalid trips data/);
  assert.throws(() => parseTripsBuffer(tripsBuffer().slice(0, 40), 0x33305054, 10), /truncated trips data/);
  assert.throws(() => parseBuildingBuffer(buildingBuffer([128])), /truncated building indices/);
  assert.throws(() => parseBuildingBuffer(buildingBuffer([8])), /invalid building index/);
});
