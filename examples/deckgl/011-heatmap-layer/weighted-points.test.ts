import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWeightedPoints } from './weighted-points.ts';

function weightedBuffer(magic: number): ArrayBuffer {
  const buffer = new ArrayBuffer(38);
  const view = new DataView(buffer);
  view.setUint32(0, magic, true); view.setUint32(4, 1, true);
  [0.1, 0.2, 0.8, 0.9].forEach((n, i) => view.setFloat32(8 + i * 4, n, true));
  view.setUint32(24, 17, true);
  new Uint16Array(buffer, 32, 3).set([100, 200, 17]);
  return buffer;
}

test('weighted heatmap points decode bounds, total weight and packed records', () => {
  const parsed = parseWeightedPoints(weightedBuffer(0x31304d48), 0x31304d48, 'heatmap');
  assert.equal(parsed.count, 1);
  parsed.bounds.forEach((value, i) => assert.ok(Math.abs(value - [0.1, 0.2, 0.8, 0.9][i]) < 1e-6));
  assert.equal(parsed.totalWeight, 17);
  assert.deepEqual([...new Uint16Array(parsed.buffer, 32)], [100, 200, 17]);
});

test('weighted screen-grid data uses its own signature and rejects malformed payloads', () => {
  assert.equal(parseWeightedPoints(weightedBuffer(0x31304753), 0x31304753, 'screen grid').count, 1);
  const wrong = weightedBuffer(0); assert.throws(() => parseWeightedPoints(wrong, 0x31304d48, 'heatmap'), /invalid heatmap data/);
  assert.throws(() => parseWeightedPoints(weightedBuffer(0x31304d48).slice(0, 37), 0x31304d48, 'heatmap'), /truncated heatmap data/);
});
