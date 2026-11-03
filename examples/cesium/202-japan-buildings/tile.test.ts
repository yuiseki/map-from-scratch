import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeTile, decodeTile, type FootprintIn } from './tile.ts';

// A 10 x 20 m box, 30.5 m tall, at (100, 200) in a 400 m tile; and a square
// with a square courtyard (two rings), 8 m tall.
const box: FootprintIn = { rings: [[[100, 200], [110, 200], [110, 220], [100, 220]]], height: 30.5, roof: [0, 1, 2, 0, 2, 3] };
const court: FootprintIn = {
  rings: [[[0, 0], [30, 0], [30, 30], [0, 30]], [[10, 10], [10, 20], [20, 20], [20, 10]]],
  height: 8,
  roof: [0, 4, 7, 0, 1, 4, 1, 5, 4, 1, 2, 5, 2, 6, 5, 2, 3, 6, 3, 7, 6, 3, 0, 7],
};
const SIZE = 400;

test('a box decodes to 8 vertices, 4 walls of 2 triangles and a roof of 2', () => {
  const t = decodeTile(encodeTile([box], SIZE));
  assert.equal(t.buildings, 1);
  assert.equal(t.chunks.length, 1);
  const { verts, idx } = t.chunks[0];
  assert.equal(verts.length, 8 * 4);
  assert.equal(idx.length, 4 * 6 + 2 * 3);
  // Positions come back within one quantum (400 m / 65535 = 6 mm), z is 0
  // at the bottom and the height (cm) on top, the 4th value is the height.
  const xy = (i: number) => [verts[4 * i] / 65535 * SIZE, verts[4 * i + 1] / 65535 * SIZE];
  for (let i = 0; i < 4; i++) {
    const [x, y] = xy(i), [ex, ey] = box.rings[0][i];
    assert.ok(Math.abs(x - ex) < 0.007 && Math.abs(y - ey) < 0.007, `vertex ${i}: ${x},${y}`);
    assert.equal(verts[4 * i + 2], 0);
    assert.equal(verts[4 * (i + 4) + 2], 3050);
    assert.equal(verts[4 * i + 3], 3050);
    assert.deepEqual(xy(i + 4), xy(i), 'top ring above bottom ring');
  }
  // Every wall triangle touches both rings; the roof uses only the top.
  for (let k = 0; k < 24; k += 3) {
    const tri = [idx[k], idx[k + 1], idx[k + 2]];
    assert.ok(tri.some((v) => v < 4) && tri.some((v) => v >= 4), `wall ${tri}`);
  }
  for (let k = 24; k < 30; k++) assert.ok(idx[k] >= 4, 'roof on top');
});

test('a courtyard keeps its inner ring: walls on both rings, roof indices shifted to the top ring', () => {
  const t = decodeTile(encodeTile([box, court], SIZE));
  assert.equal(t.buildings, 2);
  const { verts, idx } = t.chunks[0];
  assert.equal(verts.length / 4, 8 + 16);
  assert.equal(idx.length, 30 + 8 * 6 + 8 * 3);
  const roof = idx.subarray(30 + 48);
  assert.ok(Math.min(...roof) >= 8 + 8 && Math.max(...roof) < 24, 'courtyard roof on its own top ring');
  assert.equal(verts[4 * 8 + 3], 800);
  assert.equal(t.maxHeight, 30.5);
});

test('vertices past 65,535 start a new chunk, so every index fits 16 bits', () => {
  const many: FootprintIn[] = [];
  for (let i = 0; i < 20000; i++) many.push({ ...box, rings: [box.rings[0].map(([x, y]) => [x + (i % 100), y + Math.floor(i / 100)])] as [number, number][][] });
  const t = decodeTile(encodeTile(many, SIZE));
  assert.equal(t.buildings, 20000);
  assert.ok(t.chunks.length >= 3, `${t.chunks.length} chunks`);
  let verts = 0;
  for (const c of t.chunks) {
    const n = c.verts.length / 4;
    assert.ok(n <= 65535);
    assert.ok(c.idx.reduce((a, b) => Math.max(a, b), 0) < n, 'index inside its chunk');
    verts += n;
  }
  assert.equal(verts, 20000 * 8);
});

test('a building taller than the format can hold is refused at bake time', () => {
  assert.throws(() => encodeTile([{ ...box, height: 700 }], SIZE));
});
