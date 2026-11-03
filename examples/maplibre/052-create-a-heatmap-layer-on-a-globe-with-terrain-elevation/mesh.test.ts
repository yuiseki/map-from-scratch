import test from 'node:test';
import assert from 'node:assert/strict';
import { gridMesh } from './mesh.ts';

test('a grid mesh covers [0,1]^2 with (nx+1)(ny+1) vertices and 2 triangles per cell', () => {
  const m = gridMesh(4, 3, false);
  assert.equal(m.vertices.length, 5 * 4 * 3);
  assert.equal(m.indices.length, 4 * 3 * 6);
  const us = [], vs = [];
  for (let i = 0; i < m.vertices.length; i += 3) { us.push(m.vertices[i]); vs.push(m.vertices[i + 1]); }
  assert.equal(Math.min(...us), 0); assert.equal(Math.max(...us), 1);
  assert.equal(Math.min(...vs), 0); assert.equal(Math.max(...vs), 1);
  assert.ok(Math.max(...m.indices) < m.vertices.length / 3);
});

test('skirts add one lowered vertex per edge vertex and close every edge', () => {
  const m = gridMesh(4, 3, true);
  const edge = 2 * (4 + 3);                       // vertices on the rim
  assert.equal(m.vertices.length, (5 * 4 + edge) * 3);
  assert.equal(m.indices.length, (4 * 3 + edge) * 6);
  let skirts = 0;
  for (let i = 2; i < m.vertices.length; i += 3) if (m.vertices[i] === 1) {
    skirts++;
    const u = m.vertices[i - 2], v = m.vertices[i - 1];
    assert.ok(u === 0 || u === 1 || v === 0 || v === 1, 'a skirt hangs from the rim');
  }
  assert.equal(skirts, edge);
  const used = new Set(m.indices);
  for (let k = 5 * 4; k < m.vertices.length / 3; k++) assert.ok(used.has(k), `skirt vertex ${k} is drawn`);
});

test('triangles of the grid all wind the same way', () => {
  const m = gridMesh(3, 3, false);
  const V = (k: number) => [m.vertices[3 * k], m.vertices[3 * k + 1]];
  for (let t = 0; t < m.indices.length; t += 3) {
    const [a, b, c] = [V(m.indices[t]), V(m.indices[t + 1]), V(m.indices[t + 2])];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    assert.ok(cross > 0, `triangle ${t / 3}`);
  }
});
