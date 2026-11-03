import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMesh, OCEAN_ID, OCEAN_STEP } from './mesh.ts';
import type { Countries } from './format.ts';

const empty = (): Countries => ({
  lon: new Int16Array(0), lat: new Int16Array(0), id: new Uint16Array(0), idx: new Uint32Array(0),
  ringLon: new Int16Array(0), ringLat: new Int16Array(0), ringLen: new Uint32Array(0), ringId: new Uint16Array(0),
});

test('a square ring becomes four wall quads from the surface (top 0) to the lid (top 1)', () => {
  const c = empty();
  c.ringLon = Int16Array.from([0, 100, 100, 0]);
  c.ringLat = Int16Array.from([0, 0, 100, 100]);
  c.ringLen = Uint32Array.from([4]);
  c.ringId = Uint16Array.from([7]);
  const m = buildMesh(c);
  assert.equal(m.wallTriangles, 8);
  const tops = new Set<number>(), ids = new Set<number>();
  for (let v = m.wallFirstVertex; v < m.wallFirstVertex + 16; v++) { tops.add(m.verts[4 * v + 3]); ids.add(m.verts[4 * v + 2]); }
  assert.deepEqual([...tops].sort(), [0, 1]);
  assert.deepEqual([...ids], [7]);
});

test('no wall along the 180 degree cut or along a pole, where Natural Earth splits a ring', () => {
  const c = empty();
  // Chukotka-like piece: its east edge runs down lon -180; Antarctica-like
  // piece: its south edge runs along lat -90.
  c.ringLon = Int16Array.from([-18000, -17000, -17000, -18000, 0, 100, 100, 0]);
  c.ringLat = Int16Array.from([6500, 6500, 6600, 6600, -9000, -9000, -8000, -8000]);
  c.ringLen = Uint32Array.from([4, 4]);
  c.ringId = Uint16Array.from([1, 2]);
  const m = buildMesh(c);
  assert.equal(m.wallTriangles, 2 * (3 + 3));
});

test('lid vertices keep their country and stand at the top; the ocean is a grid at the surface', () => {
  const c = empty();
  c.lon = Int16Array.from([0, 100, 0]); c.lat = Int16Array.from([0, 0, 100]);
  c.id = Uint16Array.from([3, 3, 3]); c.idx = Uint32Array.from([0, 1, 2]);
  const m = buildMesh(c);
  assert.equal(m.lidTriangles, 1);
  assert.deepEqual([...m.verts.slice(m.lidFirstVertex * 4, m.lidFirstVertex * 4 + 4)], [0, 0, 3, 1]);
  const cols = 360 / OCEAN_STEP, rows = 180 / OCEAN_STEP;
  assert.equal(m.oceanTriangles, 2 * cols * rows);
  for (let v = 0; v < (cols + 1) * (rows + 1); v++) {
    assert.equal(m.verts[4 * v + 2], OCEAN_ID);
    assert.equal(m.verts[4 * v + 3], 0);
  }
  // Indices of each range point at vertices of that range.
  const lid = m.idx.slice(m.lidFirstIndex, m.lidFirstIndex + 3);
  for (const i of lid) assert.ok(i >= m.lidFirstVertex);
});

test('every wall triangle ends on a surface vertex, so the provoking vertex marks it as a wall', () => {
  const c = empty();
  c.ringLon = Int16Array.from([0, 100, 100]); c.ringLat = Int16Array.from([0, 0, 100]);
  c.ringLen = Uint32Array.from([3]); c.ringId = Uint16Array.from([0]);
  const m = buildMesh(c);
  for (let t = 0; t < m.wallTriangles; t++) assert.equal(m.verts[4 * m.idx[m.wallFirstIndex + 3 * t + 2] + 3], 0);
});
