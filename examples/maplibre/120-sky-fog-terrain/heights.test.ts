import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeHeights, decodeHeights, terrarium, sampleHeight, HEADER_BYTES, type Grid } from './heights.ts';

const meta = { z: 11, x0: 924582, y0: 409930, step: 30.79, q: 0.25 };

test('terrarium decodes the integer RGB of a Mapterhorn pixel to metres', () => {
  // 3190 m: 3190 + 32768 = 35958 = 140*256 + 118
  assert.equal(terrarium(140, 118, 0), 3190);
  assert.equal(terrarium(128, 0, 0), 0);
  assert.equal(terrarium(127, 255, 128), -0.5);
});

test('heights survive encode/decode within half a quantum, header included', () => {
  const w = 5, h = 4;
  const src = new Float32Array(w * h);
  for (let i = 0; i < src.length; i++) src[i] = 1500 + 700 * Math.sin(i * 1.7) - (i % 3) * 0.13;
  const bytes = encodeHeights(src, w, h, meta);
  assert.equal(bytes.length, HEADER_BYTES + w * h * 2);
  const g = decodeHeights(bytes);
  assert.deepEqual([g.w, g.h, g.z, g.x0, g.y0], [w, h, meta.z, meta.x0, meta.y0]);
  assert.ok(Math.abs(g.step - meta.step) < 1e-4);
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(g.heights[i] - src[i]) <= meta.q / 2 + 1e-6, `sample ${i}`);
});

test('heights are delta coded: a constant slope encodes to repeated bytes', () => {
  const w = 8, h = 2;
  const src = Float32Array.from({ length: w * h }, (_, i) => 1000 + (i % w) * 10);
  const body = encodeHeights(src, w, h, meta).subarray(HEADER_BYTES);
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // every sample after the first in a row is +40 quanta
  for (let i = 1; i < w; i++) assert.equal(dv.getInt16(i * 2, true), 40);
  // the first sample of row 1 is the difference to the first sample of row 0
  assert.equal(dv.getInt16(w * 2, true), 0);
});

test('a wrong magic is refused', () => {
  const bytes = encodeHeights(new Float32Array(4), 2, 2, meta);
  bytes[0] = 0;
  assert.throws(() => decodeHeights(bytes));
});

test('sampleHeight interpolates bilinearly in local metres, north up', () => {
  // 2x2 grid, step 100 m, row 0 is the northern row
  const g: Grid = { w: 2, h: 2, z: 11, x0: 0, y0: 0, step: 100, heights: Float32Array.from([0, 100, 200, 300]) };
  // origin: the grid's north-west sample at local (ox, oy)
  const ox = -50, oy = 50;
  assert.equal(sampleHeight(g, ox, oy, ox, oy), 0);            // NW corner
  assert.equal(sampleHeight(g, ox, oy, ox + 100, oy), 100);    // NE
  assert.equal(sampleHeight(g, ox, oy, ox, oy - 100), 200);    // SW (south is row 1)
  assert.equal(sampleHeight(g, ox, oy, 0, 0), 150);            // centre
  assert.equal(sampleHeight(g, ox, oy, 1e6, 0), null);         // outside
});
