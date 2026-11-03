import { test } from 'node:test';
import assert from 'node:assert/strict';
import { select, screenSpaceError } from './lod.ts';
import { viewOf } from './camera.ts';
import type { Tileset, TileNode, Vec3 } from './format.ts';

// One 400 m root (2 m spacing) over four 200 m leaves.
function tileset(): Tileset {
  const node = (key: string, level: number, min: Vec3, max: Vec3, ge: number, children: number[] = []): TileNode =>
    ({ key, level, min, max, count: 40_000, geometricError: ge, children, file: `${key}.bin` });
  return {
    origin: { lon: 0, lat: 0 }, roots: [0], attribution: '',
    nodes: [
      node('root', 0, [-200, -200, 0], [200, 200, 50], 2, [1, 2, 3, 4]),
      node('sw', 1, [-200, -200, 0], [0, 0, 50], 0),
      node('se', 1, [0, -200, 0], [200, 0, 50], 0),
      node('nw', 1, [-200, 0, 0], [0, 200, 50], 0),
      node('ne', 1, [0, 0, 0], [200, 200, 50], 0),
    ],
  };
}
const W = 1280, H = 800;
const all = () => true, none = () => false;
const far = viewOf({ tx: 0, ty: 0, tz: 0, heading: 0, pitch: 60, distance: 2000 }, W, H);
const near = viewOf({ tx: 0, ty: 0, tz: 0, heading: 0, pitch: 60, distance: 120 }, W, H);

test('screen space error is geometric error over distance, in CSS pixels', () => {
  assert.ok(Math.abs(screenSpaceError(2, 100, 800) - 2 * 800 / (100 * 2 * Math.tan(Math.PI / 6))) < 1e-9);
  assert.equal(screenSpaceError(0, 100, 800), 0);
});

test('far away the root is enough', () => {
  const r = select(tileset(), far, H, 16, all);
  assert.deepEqual(r.draw, [0]);
  assert.deepEqual(r.want, []);
});

test('close up the root refines into its children', () => {
  const r = select(tileset(), near, H, 16, all);
  assert.ok(!r.draw.includes(0));
  assert.ok(r.draw.length >= 2 && r.draw.every((i) => i >= 1));
});

test('a larger maximum screen space error keeps the coarse node', () => {
  assert.deepEqual(select(tileset(), near, H, 1000, all).draw, [0]);
});

test('until every visible child is loaded the parent is drawn and the children are wanted', () => {
  const r = select(tileset(), near, H, 16, (i) => i === 0 || i === 1);
  assert.deepEqual(r.draw, [0]);
  assert.ok(r.want.length >= 1 && !r.want.includes(0) && !r.want.includes(1));
});

test('nothing loaded: the root is wanted first', () => {
  const r = select(tileset(), near, H, 16, none);
  assert.deepEqual(r.draw, []);
  assert.deepEqual(r.want, [0]);
});

test('children outside the view are neither drawn nor wanted', () => {
  // Low and close, looking north from the south edge: the southern leaves
  // are behind or beside the camera at a narrow pitch.
  const v = viewOf({ tx: 100, ty: 150, tz: 0, heading: 0, pitch: 10, distance: 60 }, W, H);
  const r = select(tileset(), v, H, 16, all);
  assert.ok(!r.draw.includes(1), 'south-west leaf culled');
  assert.ok(r.draw.includes(4), 'north-east leaf drawn');
});
