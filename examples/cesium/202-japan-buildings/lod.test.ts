import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pyramid, select, sse, LruBudget, frustumPlanes, type IndexJson, type View } from './lod.ts';
import { lookAt, perspective, mul } from './camera.ts';

// A 4-level pyramid over 1,600 m: level L tiles are 1600 / 2^L wide. Errors
// are the tallest building a level leaves to its children.
const index: IndexJson = {
  origin: [35.68, 139.76], R: 6371000, x0: -800, y0: -800, size: 1600,
  levels: [{ minHeight: 100, error: 100 }, { minHeight: 30, error: 30 }, { minHeight: 10, error: 10 }, { minHeight: 0, error: 0 }],
  tiles: [
    [0, 0, 0, 5, 240, 1000],
    [1, 0, 0, 20, 90, 2000], [1, 1, 1, 20, 90, 2000],
    [2, 0, 0, 50, 29, 3000], [2, 3, 3, 50, 29, 3000],
    // Level 3 only under (1,1,1): a child of a node with no own tile at level 2.
    [3, 5, 5, 99, 9, 4000],
  ],
};

const viewFrom = (eye: [number, number, number], target: [number, number, number], maxSSE = 16): View => {
  const vp = mul(perspective(45, 1.6, 1, 100000), lookAt([0, 0, 0], [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]], [0, 0, 1]));
  return { eye, planes: frustumPlanes(vp), height: 800, tanHalfFov: Math.tan(22.5 * Math.PI / 180), maxSSE };
};

test('screen-space error: a 100 m error 10 km away on an 800 px, 45 deg view is 9.7 px', () => {
  assert.ok(Math.abs(sse(100, 10000, 800, Math.tan(22.5 * Math.PI / 180)) - 9.66) < 0.01);
});

test('from far away only the root is drawn and wanted', () => {
  const s = select(new Pyramid(index), viewFrom([0, -60000, 20000], [0, 0, 0]));
  assert.deepEqual(s.visible, ['0/0/0']);
  assert.deepEqual(s.want, ['0/0/0']);
});

test('close up, refinement adds children on top of the parent (ADD), through levels with no tile of their own', () => {
  const s = select(new Pyramid(index), viewFrom([500, -300, 150], [500, 500, 0], 4));
  for (const k of ['0/0/0', '1/1/1', '3/5/5']) assert.ok(s.visible.includes(k), `${k} in ${s.visible}`);
  assert.ok(!s.visible.includes('2/0/0'), 'a tile outside the view is not drawn');
  // Loading order: largest screen-space error first, so the parent comes before its children.
  assert.ok(s.want.indexOf('0/0/0') < s.want.indexOf('3/5/5'));
});

test('tiles behind the camera are culled', () => {
  const s = select(new Pyramid(index), viewFrom([-700, 0, 50], [-2000, 0, 0], 1));
  assert.ok(!s.visible.includes('1/1/1') && !s.visible.includes('3/5/5'), `${s.visible}`);
  assert.ok(s.visible.includes('0/0/0'));
});

test('the LRU budget evicts the least recently used tile first and never one in use', () => {
  const lru = new LruBudget(100);
  lru.add('a', 40, 1); lru.add('b', 40, 2); lru.add('c', 40, 3);
  lru.touch('a', 4);
  assert.deepEqual(lru.evict(new Set(['c'])), ['b']);
  assert.equal(lru.bytes, 80);
  // Everything in use: over budget, but nothing may go.
  lru.add('d', 60, 5);
  assert.deepEqual(lru.evict(new Set(['a', 'c', 'd'])), []);
  assert.equal(lru.bytes, 140);
  assert.deepEqual(lru.evict(new Set(['d'])), ['c'], 'c was used at frame 3, a at 4');
  assert.ok(lru.bytes <= 100);
});
