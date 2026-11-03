import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CS, decodeChunk, encodeChunk, ENTRY_BYTES, fileOrder, HEADER_BYTES, LEVELS, N0, parseTerr, perSide, ranges, S, type Terr } from './terrain.ts';

test('terrain chunks encode and decode planar samples with signed residuals', () => {
  const samples = new Uint16Array(S * S);
  for (let r = 0; r < S; r++) for (let c = 0; c < S; c++) samples[r * S + c] = 24000 + r * 3 - c * 2 + ((r * c) % 7) * 5;
  for (const block of [1, 32, 257, S * S]) {
    const bytes = encodeChunk(samples, block);
    const decoded = new Uint16Array(samples.length);
    decodeChunk(bytes, decoded, block);
    assert.deepEqual(decoded, samples);
  }
});

test('terrain file order stores all chunks coarse first and parse reconstructs offsets and level ids', () => {
  const order = fileOrder();
  assert.equal(order.length, perSide(0) ** 2 + perSide(1) ** 2 + perSide(2) ** 2 + perSide(3) ** 2);
  assert.deepEqual(order.slice(0, 3).map(([k]) => k), [3, 3, 3]);
  assert.deepEqual(order.slice(-3).map(([k]) => k), [0, 0, 0]);
  assert.equal(new Set(order.map(([k, i, j]) => `${k}/${i}/${j}`)).size, order.length);

  const count = order.length, bytes = new Uint8Array(HEADER_BYTES + ENTRY_BYTES * count + count);
  bytes.set([77, 70, 83, 84]);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(4, 1, true); dv.setUint16(6, CS, true); bytes[8] = 1; bytes[9] = LEVELS; dv.setUint16(10, count, true);
  dv.setUint32(12, 1000, true); dv.setUint32(16, 2000, true); bytes[20] = 32;
  dv.setFloat64(24, 2, true); dv.setFloat64(32, 35, true); dv.setFloat64(40, 139, true); dv.setFloat32(48, 0.25, true);
  for (let i = 0; i < count; i++) {
    const off = HEADER_BYTES + i * ENTRY_BYTES;
    dv.setUint16(off, 1, true); dv.setUint16(off + 2, 4, true); dv.setUint16(off + 4, 80, true); bytes[off + 6] = 3;
  }
  const terrain = parseTerr(bytes);
  assert.equal(terrain.chunks.length, count);
  assert.deepEqual(terrain.chunks[0], { k: 3, i: 0, j: 0, off: HEADER_BYTES + ENTRY_BYTES * count, len: 1, hmin: 1, hmax: 20, skirt: 6 });
  assert.equal(terrain.ids[3][0], 0);
  assert.equal(terrain.chunks.at(-1)?.off, bytes.length - 1);
  assert.equal(terrain.x0, 1000);
  assert.equal(terrain.y0, 2000);
  assert.equal(terrain.cell, 2);
  assert.equal(terrain.lon0, 139);
});

test('range planner merges nearby chunks, honors the gap limit, and sorts ids by file offset', () => {
  const terrain = {
    chunks: [
      { off: 100, len: 10 }, { off: 125, len: 5 }, { off: 500, len: 20 },
    ],
  } as Terr;
  assert.deepEqual(ranges(terrain, [2, 1, 0], 15), [
    { start: 100, end: 130, ids: [0, 1] },
    { start: 500, end: 520, ids: [2] },
  ]);
});

test('terrain parser distinguishes bad format signatures and incompatible layouts', () => {
  assert.throws(() => parseTerr(new Uint8Array(64)), /not a \.terr v1 file/);
  const bytes = new Uint8Array(64);
  bytes.set([77, 70, 83, 84]);
  const dv = new DataView(bytes.buffer);
  dv.setUint16(4, 1, true); dv.setUint16(6, CS + 1, true); bytes[8] = 1; bytes[9] = LEVELS;
  assert.throws(() => parseTerr(bytes), /unexpected chunk layout/);
  assert.ok(N0 > CS);
});
