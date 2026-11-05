import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateDeflate, undoFloatPredictor3 } from './deflate.ts';

test('inflates a bounded DEFLATE stream to an exact tile byte count', async () => {
  const stream = new CompressionStream('deflate');
  const writer2 = stream.writable.getWriter();
  const written = writer2.write(new Uint8Array([1, 2, 3, 4]));
  const closed = writer2.close();
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  await Promise.all([written, closed]);
  const compressed = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) { compressed.set(chunk, offset); offset += chunk.length; }
  assert.deepEqual([...await inflateDeflate(compressed, 4)], [1, 2, 3, 4]);
  await assert.rejects(inflateDeflate(compressed, 3), /exceeds|expected/i);
});

test('undoes TIFF floating point predictor 3 for little endian Float32 rows', () => {
  // 1.5 and 2.5 float bytes, shuffled high-byte first and differenced.
  const predicted = new Uint8Array([0x3f, 0x01, 0x80, 0x60, 0xe0, 0x00, 0x00, 0x00]);
  const decoded = undoFloatPredictor3(predicted, 2, 1, true);
  const view = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  assert.equal(view.getFloat32(0, true), 1.5);
  assert.equal(view.getFloat32(4, true), 2.5);
});
