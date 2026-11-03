import assert from 'node:assert/strict';
import test from 'node:test';
import { subdivide, toEcef, EARTH_R } from './land.ts';

const edgeDeg = (v: ArrayLike<number>, a: number, b: number) => Math.hypot(v[2 * a] - v[2 * b], v[2 * a + 1] - v[2 * b + 1]);

test('ECEF on the sphere: lon 0 lat 0 is +x, lon 90 is +y, the pole is +z', () => {
  const near = (a: number[], b: number[]) => a.every((x, i) => Math.abs(x - b[i]) < 1e-9);
  assert.ok(near(toEcef(0, 0, 0), [EARTH_R, 0, 0]));
  assert.ok(near(toEcef(90, 0, 0), [0, EARTH_R, 0]));
  assert.ok(near(toEcef(0, 90, 10), [0, 0, EARTH_R + 10]));
});

test('subdivide: every edge ends up no longer than the limit, and the area is unchanged', () => {
  const v = [120, 20, 150, 20, 140, 45], idx = [0, 1, 2];
  const out = subdivide(v, idx, 1);
  let area = 0;
  for (let t = 0; t < out.indices.length; t += 3) {
    const [a, b, c] = [out.indices[t], out.indices[t + 1], out.indices[t + 2]];
    for (const [p, q] of [[a, b], [b, c], [c, a]]) assert.ok(edgeDeg(out.vertices, p, q) <= 1 + 1e-9);
    const x = out.vertices;
    area += ((x[2 * b] - x[2 * a]) * (x[2 * c + 1] - x[2 * a + 1]) - (x[2 * c] - x[2 * a]) * (x[2 * b + 1] - x[2 * a + 1])) / 2;
  }
  assert.ok(Math.abs(area - (30 * 25) / 2) < 1e-6, `area ${area}`);
});

test('subdivide: two triangles sharing a long edge split it at the same points (no cracks)', () => {
  const v = [0, 0, 10, 0, 5, 3, 5, -3], idx = [0, 1, 2, 1, 0, 3];
  const out = subdivide(v, idx, 1);
  // every vertex on the shared edge y = 0 is used by triangles on both sides
  const onEdge = new Map<number, Set<number>>();
  for (let t = 0; t < out.indices.length; t += 3) {
    const tri = [out.indices[t], out.indices[t + 1], out.indices[t + 2]];
    const side = Math.sign(tri.reduce((s, i) => s + out.vertices[2 * i + 1], 0));
    for (const i of tri) if (out.vertices[2 * i + 1] === 0) (onEdge.get(i) ?? onEdge.set(i, new Set()).get(i)!).add(side);
  }
  assert.ok(onEdge.size >= 11, `${onEdge.size} vertices on the shared edge`);
  for (const [i, sides] of onEdge) assert.equal(sides.size, 2, `vertex ${i} at x=${out.vertices[2 * i]} used by one side only`);
});

test('small triangles pass through untouched', () => {
  const out = subdivide([139, 35, 139.5, 35, 139.2, 35.4], [0, 1, 2], 1);
  assert.deepEqual(Array.from(out.indices), [0, 1, 2]);
  assert.equal(out.vertices.length, 6);
});
