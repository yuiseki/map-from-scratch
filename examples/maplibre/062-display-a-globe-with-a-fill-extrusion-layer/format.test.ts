import assert from 'node:assert/strict';
import test from 'node:test';
import { encode, decode } from './format.ts';

test('countries.bin round-trips lid vertices, indices and rings through delta coding', () => {
  const src = {
    lon: Int16Array.from([-18000, 17999, 0, 5]), lat: Int16Array.from([-9000, 9000, 1, -1]),
    id: Uint16Array.from([0, 0, 1, 1]), idx: Uint32Array.from([0, 1, 2, 2, 3, 0]),
    ringLon: Int16Array.from([18000, 18000, -300]), ringLat: Int16Array.from([100, -100, 0]),
    ringLen: Uint32Array.from([3]), ringId: Uint16Array.from([1]),
  };
  const bytes = encode(src);
  // Deltas wrap: -18000 then 17999 is a jump of 35999, more than int16 holds.
  const out = decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  for (const k of Object.keys(src) as (keyof typeof src)[]) assert.deepEqual([...out[k]], [...src[k]], k);
});

test('an index jump beyond int16 is refused at bake time instead of wrapping', () => {
  const z = { lon: new Int16Array(0), lat: new Int16Array(0), id: new Uint16Array(0), ringLon: new Int16Array(0), ringLat: new Int16Array(0), ringLen: new Uint32Array(0), ringId: new Uint16Array(0) };
  assert.throws(() => encode({ ...z, idx: Uint32Array.from([0, 40000, 1]) }), /int16/);
});
