import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePoints, decodePoints, yearRange } from './points.ts';

const pts = [
  { u: 0.5, v: 0.25, year: 2025 },
  { u: 0, v: 1, year: 2022 },
  { u: 0.75, v: 0.5, year: 2025 },
  { u: 1, v: 0, year: 2024 },
];

test('points are grouped by year and keep their position to 1/65535 of the area', () => {
  const p = decodePoints(encodePoints(pts).buffer as ArrayBuffer);
  assert.equal(p.count, 4);
  assert.equal(p.firstYear, 2022);
  assert.deepEqual([...p.yearCounts], [1, 0, 1, 2]);
  // Sorted by year: 2022 first, then 2024, then the two 2025 points.
  const u = (i: number) => p.uv[2 * i] / 65535, v = (i: number) => p.uv[2 * i + 1] / 65535;
  assert.equal(u(0), 0); assert.equal(v(0), 1);
  assert.equal(u(1), 1); assert.equal(v(1), 0);
  assert.ok(Math.abs(u(2) - 0.5) < 1e-4 || Math.abs(u(2) - 0.75) < 1e-4);
});

test('yearRange gives the draw range of one year, or of all years with 0', () => {
  const p = decodePoints(encodePoints(pts).buffer as ArrayBuffer);
  assert.deepEqual(yearRange(p, 0), [0, 4]);
  assert.deepEqual(yearRange(p, 2025), [2, 4]);
  assert.deepEqual(yearRange(p, 2023), [1, 1]);
  assert.deepEqual(yearRange(p, 2022), [0, 1]);
  assert.deepEqual(yearRange(p, 2030), [0, 0]);
});

test('a file with the wrong magic is refused', () => {
  const b = encodePoints(pts);
  b[0] = 0;
  assert.throws(() => decodePoints(b.buffer as ArrayBuffer));
});
