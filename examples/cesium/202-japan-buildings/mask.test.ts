import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Mask } from './mask.ts';

// A 10 x 10 cell grid over lon 0..10, lat 10..0 (row 0 at the north), 4x4 samples per cell.
const grid = () => new Mask({ w: 10, h: 10, lon0: 0, lat0: 10, dlon: 1, dlat: 1 }, 4);
const at = (m: Mask, c: number, r: number) => m.coverage()[r * 10 + c];

test('a polygon covering whole cells fills them and nothing else', () => {
  const m = grid();
  m.fill([[[2, 8], [4, 8], [4, 6], [2, 6]]], 1);
  assert.equal(at(m, 2, 2), 255); assert.equal(at(m, 3, 3), 255);
  assert.equal(at(m, 1, 2), 0); assert.equal(at(m, 4, 2), 0); assert.equal(at(m, 2, 1), 0); assert.equal(at(m, 2, 4), 0);
});

test('a half-covered cell gets half coverage; north is row 0', () => {
  const m = grid();
  m.fill([[[0, 10], [10, 10], [10, 9.5], [0, 9.5]]], 1);
  assert.ok(Math.abs(at(m, 5, 0) - 128) <= 1, `${at(m, 5, 0)}`);
  assert.equal(at(m, 5, 9), 0);
});

test('a hole (even-odd) and a later water polygon both clear land', () => {
  const m = grid();
  m.fill([[[0, 10], [10, 10], [10, 0], [0, 0]], [[1, 9], [3, 9], [3, 7], [1, 7]]], 1);
  m.fill([[[6, 4], [8, 4], [8, 2], [6, 2]]], 0);
  assert.equal(at(m, 2, 2), 0, 'courtyard');
  assert.equal(at(m, 7, 7), 0, 'lake');
  assert.equal(at(m, 5, 5), 255);
});
