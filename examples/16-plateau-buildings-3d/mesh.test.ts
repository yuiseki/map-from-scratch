import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTile, expectedTriangles, hilbert, level0, place, type Placed } from './mesh.ts';
import type { Building } from './gml.ts';

const building = (): Building => {
  const ring = [
    35.68124, 139.76712, 10,
    35.68124, 139.76722, 10,
    35.68134, 139.76712, 10,
    35.68124, 139.76712, 10,
  ];
  const poly = [ring];
  return { id: 'b1', lod1: [poly], lod2: [poly], inst: [poly] };
};

test('building placement assigns its mean position to one 250 m tile and rejects outside buildings', () => {
  const b = building();
  const placed = place(b);
  assert.ok(placed);
  assert.equal(placed.b, b);
  assert.ok(placed.x > -1000 && placed.x < 1000);
  assert.ok(placed.y > -1000 && placed.y < 1000);
  assert.ok(placed.tile >= 0 && placed.tile < 64);
  assert.equal(level0({ ...b, lod2: [] }).length, 1);
  assert.equal(place({ ...b, lod1: [] }), null);
  assert.equal(place({ ...b, lod1: [[[35.68124, 139.8, 0]]] }), null);
});

test('Hilbert tile order visits every tile once and polygon triangle estimate accounts for holes', () => {
  const order = Array.from({ length: 64 }, (_, i) => hilbert(i % 8, Math.floor(i / 8)));
  assert.equal(new Set(order).size, 64);
  assert.equal(Math.min(...order), 0);
  assert.equal(Math.max(...order), 63);
  assert.equal(expectedTriangles([[0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0]]), 1);
  assert.equal(expectedTriangles([
    [0, 0, 0, 4, 0, 0, 4, 4, 0, 0, 0, 0],
    [1, 1, 0, 2, 1, 0, 2, 2, 0, 1, 1, 0],
  ]), 6);
});

test('tile mesh emits quantized vertices and triangle indices for both PLATEAU levels', () => {
  const b = building();
  const placed = place(b)!;
  const tile: Placed = { ...placed, x: 0, y: 0, tile: 27 };
  const mesh = buildTile(27, [tile]);
  assert.equal(mesh.tile, 27);
  assert.equal(mesh.buildings, 1);
  assert.equal(mesh.levels.length, 2);
  for (const level of mesh.levels) {
    assert.equal(level.expected, 1);
    assert.equal(level.dropped, 0);
    assert.equal(level.idx.length, 3);
    assert.ok(level.nv >= 3 && level.nv <= 4);
    assert.equal(level.q.length, level.nv * 3);
    assert.ok([...level.q].every((q) => q >= 0 && q < 65000));
    assert.ok([...level.idx].every((i) => i < level.nv));
  }
});
