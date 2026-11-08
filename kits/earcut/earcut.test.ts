// The oracle is mapbox/earcut's own test suite (test/test.js and
// test/expected.json at 934e54d, 2026-10-23): the fixtures and their expected
// triangle counts and area deviations are copied into fixtures/ unchanged
// (ISC, LICENSE). refine() is not ported, so its tests are not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import earcut, { build, deviation, flatten, largePool } from './earcut.ts';
import { readTilesFixture, TILES_FIXTURE } from '../../tools/earcut-tiles.ts';

interface Expected {
  triangles: Record<string, number>;
  errors: Record<string, number>;
  'errors-with-rotation': Record<string, number>;
}
const fixtures = new URL('./fixtures/', import.meta.url);
const expected = JSON.parse(readFileSync(new URL('expected.json', fixtures), 'utf8')) as Expected;

test('indices-2d', () => {
  assert.deepEqual(earcut([10, 0, 0, 50, 60, 60, 70, 10]), [1, 0, 3, 1, 3, 2]);
});

test('indices-3d', () => {
  assert.deepEqual(earcut([10, 0, 0, 0, 50, 0, 60, 60, 0, 70, 10, 0], null, 3), [1, 0, 3, 1, 3, 2]);
});

test('typed array input gives the same indices as a plain array', () => {
  const v = [10, 0, 0, 50, 60, 60, 70, 10, 30, 20, 40, 30, 35, 40];
  assert.deepEqual(earcut(new Float64Array(v), [4]), earcut(v, [4]));
  assert.deepEqual(earcut(new Int16Array(v), new Uint32Array([4])), earcut(v, [4]));
});

test('empty', () => {
  assert.deepEqual(earcut([]), []);
});

test('flatten skips empty rings', () => {
  const outer = [[0, 0], [10, 0], [10, 10], [0, 10]], hole = [[2, 2], [4, 2], [3, 4]];
  assert.deepEqual(flatten([outer, hole, []]), flatten([outer, hole]));
  const { vertices, holes, dimensions } = flatten([outer, []]);
  assert.deepEqual(earcut(vertices, holes, dimensions), earcut(flatten([outer]).vertices));
});

test('every fixture file has an expectation', () => {
  const files = readdirSync(fixtures).filter((f) => f.endsWith('.json') && f !== 'expected.json').map((f) => f.slice(0, -5));
  assert.deepEqual(files.sort(), Object.keys(expected.triangles).sort());
  assert.equal(files.length, 61);
});

// Upstream checks the triangle count unrotated and the area deviation at four
// right-angle rotations, against the bounds it recorded.
for (const id of Object.keys(expected.triangles)) {
  test(`fixture ${id} at 0, 90, 180 and 270 degrees`, () => {
    for (const rotation of [0, 90, 180, 270]) {
      const coords = JSON.parse(readFileSync(new URL(`${id}.json`, fixtures), 'utf8')) as number[][][];
      const t = rotation * Math.PI / 180;
      const xx = Math.round(Math.cos(t)), xy = Math.round(-Math.sin(t)), yx = Math.round(Math.sin(t)), yy = Math.round(Math.cos(t));
      if (rotation) for (const ring of coords) for (const c of ring) [c[0], c[1]] = [xx * c[0] + xy * c[1], yx * c[0] + yy * c[1]];
      const data = flatten(coords);
      const indices = earcut(data.vertices, data.holes, data.dimensions);
      const err = deviation(data.vertices, data.holes, data.dimensions, indices);
      const want = expected.triangles[id];
      const bound = (rotation !== 0 && expected['errors-with-rotation'][id]) || expected.errors[id] || 0;
      if (rotation === 0) assert.equal(indices.length / 3, want, `${id}: triangles`);
      if (want > 0) assert.ok(err <= bound, `${id} at ${rotation}: deviation ${err} > ${bound}`);
      for (const i of indices) assert.ok(Number.isInteger(i) && i >= 0 && i < data.vertices.length / data.dimensions, `${id}: index ${i}`);
    }
  });
}

test('infinite-loop', () => {
  earcut([1, 2, 2, 2, 1, 2, 1, 1, 1, 2, 4, 1, 5, 1, 3, 2, 4, 2, 4, 1], [5], 2);
});

test('large convex polygon is cut without point checks', { timeout: 2000 }, () => {
  // Upstream: with point checks each hashed check of the fan of long
  // triangles scans much of the ring, seconds instead of milliseconds.
  const n = 100000, vertices: number[] = [];
  for (let i = 0; i < n; i++) vertices.push(Math.cos(2 * Math.PI * i / n), Math.sin(2 * Math.PI * i / n));
  const triangles = earcut(vertices);
  assert.equal(triangles.length / 3, n - 2);
  assert.ok(deviation(vertices, null, 2, triangles) < 1e-12);
});

test('nested splits do not overflow a small call stack', async () => {
  // A rectangle with k small triangular holes, each one step right and down
  // from the previous; every hole adds a level of nested splits. Recursive
  // splitting overflows a browser-worker-sized stack from k = 400 or so.
  const url = new URL('./earcut.ts', import.meta.url).href;
  const worker = new Worker(`
    const { parentPort, workerData: { url, k } } = require('node:worker_threads');
    const vertices = [-1, -k, 2 * k + 1, -k, 2 * k + 1, 7, -1, 7], holes = [];
    for (let i = 0; i < k; i++) {
      holes.push(vertices.length / 2);
      vertices.push(1 + 2 * i, -i, 2 * i, 6 - i, 2 + 2 * i, 6 - i);
    }
    import(url).then(({ default: earcut, deviation }) => {
      const triangles = earcut(vertices, holes);
      parentPort.postMessage([triangles.length / 3, deviation(vertices, holes, 2, triangles)]);
    });
  `, { eval: true, workerData: { url, k: 600 }, resourceLimits: { stackSizeMb: 0.35 } });
  const [count, dev] = await new Promise<[number, number]>((resolve, reject) => {
    worker.on('message', resolve).on('error', reject);
    worker.on('exit', (code) => reject(new Error(`worker exited with code ${code}`)));
  });
  await worker.terminate();
  assert.equal(count, 3002);
  assert.equal(dev, 0);
});

test('collinear polygon has zero deviation despite shoelace roundoff', () => {
  const vertices = [0.1, 0.2, 1.3, 2.6, 2.5, 5.0, 3.7, 7.4]; // on y = 2x
  const triangles = earcut(vertices);
  assert.equal(triangles.length, 0);
  assert.equal(deviation(vertices, null, 2, triangles), 0);
});

test('a collinear run healed across a hole-bridge block keeps every hole (upstream #183)', () => {
  const N = 30, outer: number[][] = [];
  for (let x = 0; x <= N; x++) outer.push([x, 0]);
  for (let y = 1; y <= N; y++) outer.push([N, y]);
  for (let x = N - 1; x >= 0; x--) outer.push([x, N]);
  for (let y = N - 1; y >= 1; y--) outer.push([0, y]);
  const rect = (x0: number, y0: number, w: number, h: number) => [[x0, y0], [x0, y0 + h], [x0 + w, y0 + h], [x0 + w, y0]];
  const rings = [outer, rect(5, 5, 2, 4), rect(2, 23, 1, 1)];
  for (const rotation of [0, 90, 180, 270]) {
    const t = rotation * Math.PI / 180;
    const xx = Math.round(Math.cos(t)), xy = Math.round(-Math.sin(t)), yx = Math.round(Math.sin(t)), yy = Math.round(Math.cos(t));
    const data = flatten(rings.map((r) => r.map(([x, y]) => [xx * x + xy * y, yx * x + yy * y])));
    const indices = earcut(data.vertices, data.holes, data.dimensions);
    const err = deviation(data.vertices, data.holes, data.dimensions, indices);
    assert.ok(err < 1e-9, `rotation ${rotation}: deviation ${err} (hole dropped?)`);
  }
});

test('a call after one that split many times starts clean', () => {
  // The node pool and the split stack are module state reused across calls.
  const k = 50, vertices = [-1, -k, 2 * k + 1, -k, 2 * k + 1, 7, -1, 7], holes: number[] = [];
  for (let i = 0; i < k; i++) {
    holes.push(vertices.length / 2);
    vertices.push(1 + 2 * i, -i, 2 * i, 6 - i, 2 + 2 * i, 6 - i);
  }
  const first = earcut(vertices, holes);
  assert.deepEqual(earcut([10, 0, 0, 50, 60, 60, 70, 10]), [1, 0, 3, 1, 3, 2]);
  assert.deepEqual(earcut(vertices, holes), first);
});

// The node pool is fixed in size (see earcut.ts). These run small pools.
function nestedHoles(k: number): { vertices: number[]; holes: number[] } {
  const vertices = [-1, -k, 2 * k + 1, -k, 2 * k + 1, 7, -1, 7], holes: number[] = [];
  for (let i = 0; i < k; i++) {
    holes.push(vertices.length / 2);
    vertices.push(1 + 2 * i, -i, 2 * i, 6 - i, 2 + 2 * i, 6 - i);
  }
  return { vertices, holes };
}

test('an input larger than the pool goes to grow with the nodes it needs', () => {
  const calls: number[] = [];
  const pool = build(32, (d, h, dim, need) => { calls.push(need); return earcut(d, h, dim); });
  const ring: number[] = [];
  for (let i = 0; i < 20; i++) ring.push(Math.cos(i / 20 * 2 * Math.PI), Math.sin(i / 20 * 2 * Math.PI));
  assert.deepEqual(pool.run(ring), earcut(ring));
  assert.deepEqual(calls, [20 + 16]);
  assert.deepEqual(pool.run([0, 0, 1, 0, 1, 1]), earcut([0, 0, 1, 0, 1, 1]));
  assert.deepEqual(calls, [36], 'a small input stays in the pool');
});

test('splits that overflow the pool are redone in a larger one, and the pool works after', () => {
  // 20 nested holes: 64 vertices and 40 bridge nodes fit a pool of 120;
  // the splits that follow need about 40 more.
  const { vertices, holes } = nestedHoles(20);
  const cap = vertices.length / 2 + 2 * holes.length + 16;
  const calls: number[] = [];
  const pool = build(cap, (d, h, dim, need) => { calls.push(need); return earcut(d, h, dim); });
  const triangles = pool.run(vertices, holes);
  assert.deepEqual(calls, [2 * cap], 'overflow, not the up-front check');
  assert.deepEqual(triangles, earcut(vertices, holes));
  assert.equal(deviation(vertices, holes, 2, triangles), 0);
  // the overflow left no split halves or hole index behind
  assert.deepEqual(pool.run([10, 0, 0, 50, 60, 60, 70, 10]), [1, 0, 3, 1, 3, 2]);
  const square = flatten([[[0, 0], [10, 0], [10, 10], [0, 10]], [[2, 2], [4, 2], [3, 4]]]);
  assert.deepEqual(pool.run(square.vertices, square.holes), earcut(square.vertices, square.holes));
});

test('a polygon past the first pool is cut by a pool compiled from source, with the same output', () => {
  const n = 20000, ring: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = i % 2 ? 1 : 0.6; // a star: half its vertices are reflex
    ring.push(r * Math.cos(2 * Math.PI * i / n), r * Math.sin(2 * Math.PI * i / n));
  }
  const triangles = earcut(ring);
  const pool = largePool();
  assert.ok(pool && pool.cap >= n + 16, JSON.stringify(pool));
  assert.equal(pool.compiled, true, 'new Function failed, fell back to build()');
  assert.equal(triangles.length / 3, n - 2);
  assert.ok(deviation(ring, null, 2, triangles) < 1e-12);
  assert.deepEqual(triangles, build(1 << 16, () => { throw new Error('no grow'); }).run(ring));
});

// 119,680 real MVT polygons. Upstream asserts every one triangulates with zero
// deviation. CI has no ref-repos, so it runs where ref-repos/clone.sh has run.
test('every polygon of upstream\'s MVT fixture has zero deviation', { skip: existsSync(TILES_FIXTURE) ? false : 'ref-repos/clone.sh earcut' }, () => {
  const polys = readTilesFixture();
  assert.equal(polys.length, 119680);
  let nonzero = 0, first = -1;
  for (let i = 0; i < polys.length; i++) {
    const d = polys[i];
    if (deviation(d.vertices, d.holes, d.dimensions, earcut(d.vertices, d.holes, d.dimensions)) !== 0) {
      nonzero++;
      if (first < 0) first = i;
    }
  }
  assert.equal(nonzero, 0, `${nonzero} polygons with nonzero deviation, first ${first}`);
});
