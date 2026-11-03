import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeChunk, encodeChunk, fileOrder, perSide, S } from './terrain.ts';

test('aerial terrain uses the same coarse-first chunk grid and covers every cell once', () => {
  const order = fileOrder();
  assert.equal(order.length, [0, 1, 2, 3].reduce((sum, k) => sum + perSide(k) ** 2, 0));
  assert.ok(order.slice(0, perSide(3) ** 2).every(([k]) => k === 3));
  assert.ok(order.slice(-(perSide(0) ** 2)).every(([k]) => k === 0));
  assert.equal(new Set(order.map(([k, i, j]) => `${k}/${i}/${j}`)).size, order.length);
});

test('Rice chunk coding round-trips non-flat height samples for different block sizes', () => {
  const source = new Uint16Array(S * S);
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) source[r * S + c] = 18000 + r * 2 + c * 3 + (r * c % 11);
  for (const block of [32, 173, source.length]) {
    const decoded = new Uint16Array(source.length);
    decodeChunk(encodeChunk(source, block), decoded, block);
    assert.deepEqual(decoded, source);
  }
});
