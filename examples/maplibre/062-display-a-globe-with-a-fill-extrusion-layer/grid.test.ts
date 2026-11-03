import assert from 'node:assert/strict';
import test from 'node:test';
import { densifyRing, clipRing, ringArea, cellPieces, triangulateCells } from './grid.ts';

test('densifyRing inserts a vertex at every grid line an edge crosses', () => {
  // One edge from x=-100 to x=700 at y=50 crosses x=0, 300 and 600.
  const out = densifyRing([[-100, 50], [700, 50], [700, 60], [-100, 60]], 300);
  const xs = out.slice(0, 5).map((p) => p[0]);
  assert.deepEqual(xs, [-100, 0, 300, 600, 700]);
  // Every edge now stays inside one cell column and row.
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    assert.ok(Math.floor(Math.min(a[0], b[0]) / 300) >= Math.floor(Math.max(a[0], b[0]) / 300) - 1);
    assert.ok(!(Math.min(a[0], b[0]) < 300 && Math.max(a[0], b[0]) > 300), 'edge crosses x=300');
  }
});

test('clipRing keeps the part of a ring inside a cell', () => {
  const sq = [[-50, -50], [150, -50], [150, 150], [-50, 150]];
  const piece = clipRing(sq, 0, 0, 100, 100);
  assert.equal(Math.abs(ringArea(piece)), 100 * 100);
  assert.equal(clipRing(sq, 200, 200, 300, 300).length, 0);
});

test('cell pieces cover exactly the polygon area, holes removed', () => {
  const outer = densifyRing([[-450, -320], [910, -320], [910, 700], [-450, 700]], 300);
  const hole = densifyRing([[100, 100], [100, 400], [500, 400], [500, 100]], 300);
  const pieces = cellPieces([outer, hole], 300);
  let sum = 0;
  for (const p of pieces) {
    sum += Math.abs(ringArea(p.rings[0]));
    for (const h of p.rings.slice(1)) sum -= Math.abs(ringArea(h));
  }
  assert.equal(sum, 1360 * 1020 - 400 * 300);
});

test('triangles stay inside one cell, so no lid edge is longer than a cell diagonal', () => {
  const outer = densifyRing([[-1000, -1000], [1000, -1000], [0, 1500]], 300);
  const { vertices, indices } = triangulateCells([outer], 300);
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]].map((k) => [vertices[2 * k], vertices[2 * k + 1]]);
    for (const [p, q] of [[a, b], [b, c], [c, a]]) assert.ok(Math.hypot(p[0] - q[0], p[1] - q[1]) <= 300 * Math.SQRT2 + 1e-9);
    area += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
  }
  assert.ok(Math.abs(area - 2000 * 2500 / 2) < 2000 * 2500 / 2 * 0.002, `area ${area}`);
});
