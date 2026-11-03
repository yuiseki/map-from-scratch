import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeHeatmapData } from './heatmap-data.ts';

test('heatmap decoder reads the point count and packed world-coordinate triples', () => {
  const buffer = new ArrayBuffer(8 + 2 * 3 * 4);
  const view = new DataView(buffer);
  new Uint8Array(buffer).set([...'EQHM'].map((c) => c.charCodeAt(0))); // as bake.ts writes it
  view.setUint32(4, 2, true);
  [0.5, 0.25, 0.75, 0.1, 0.9, 0.2].forEach((value, i) => view.setFloat32(8 + i * 4, value, true));

  const data = decodeHeatmapData(buffer);
  assert.equal(data.count, 2);
  assert.deepEqual([...data.points], [...new Float32Array([0.5, 0.25, 0.75, 0.1, 0.9, 0.2])]);
});
