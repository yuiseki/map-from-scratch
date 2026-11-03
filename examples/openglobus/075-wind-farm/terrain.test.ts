import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeTerrain, decodeTerrain, gridIndices, heightAt, toLocal, QUANTUM } from './terrain.ts';

const meta = { w: 3, h: 2, cell: 10, x0: -5, y0: 100, lon0: 140.25, lat0: 40.8 };

test('terrain file round-trips its grid at a quarter-metre and clamps the sea to 0 m', () => {
  const t = decodeTerrain(encodeTerrain(meta, new Float64Array([0, 1.1, 2.6, -3, 1625.4, 7])).buffer as ArrayBuffer);
  assert.equal(QUANTUM, 0.25);
  assert.deepEqual([t.w, t.h, t.cell, t.x0, t.y0, t.lon0, t.lat0], [3, 2, 10, -5, 100, 140.25, 40.8]);
  assert.deepEqual([...t.raw].map((v) => v * QUANTUM), [0, 1, 2.5, 0, 1625.5, 7]);
});

test('decodeTerrain rejects a file that is not a terrain grid', () => {
  assert.throws(() => decodeTerrain(new Uint8Array(64).buffer), /magic/);
});

test('local metres: one degree of latitude is about 111.2 km, longitude shrinks by cos(lat0)', () => {
  const [x, y] = toLocal(141.25, 41.8, 140.25, 40.8);
  assert.ok(Math.abs(y - 111195) < 10, `y ${y}`);
  assert.ok(Math.abs(x - 111195 * Math.cos((40.8 * Math.PI) / 180)) < 10, `x ${x}`);
});

test('grid indices: two counter-clockwise triangles per cell, split along the south-west to north-east diagonal', () => {
  const idx = gridIndices(3, 2);
  assert.equal(idx.length, 2 * 2 * 3);
  assert.deepEqual([...idx.slice(0, 6)], [0, 1, 4, 0, 4, 3]);
  for (let t = 0; t < idx.length; t += 3) {
    const p = [idx[t], idx[t + 1], idx[t + 2]].map((v) => [v % 3, Math.floor(v / 3)]);
    const area = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[2][0] - p[0][0]) * (p[1][1] - p[0][1]);
    assert.ok(area > 0, `triangle ${t / 3} is not CCW seen from above`);
  }
});

// heightAt must give the height of the drawn surface, i.e. lie on the plane
// of the triangle (from gridIndices) that contains the point, so that a tower
// base set to it touches the mesh.
test('heightAt lies on the plane of the drawn triangle that contains the point', () => {
  const heights = new Float64Array([0, 40, 8, 100, 20, 12]);
  const t = decodeTerrain(encodeTerrain(meta, heights).buffer as ArrayBuffer);
  const idx = gridIndices(3, 2);
  const vert = (v: number) => [meta.x0 + (v % 3) * 10, meta.y0 + Math.floor(v / 3) * 10, t.raw[v] * QUANTUM];
  let n = 0;
  for (let s = 0; s < 200; s++) {
    const x = meta.x0 + ((s * 37) % 199) / 10, y = meta.y0 + ((s * 53) % 97) / 10;
    for (let k = 0; k < idx.length; k += 3) {
      const [a, b, c] = [idx[k], idx[k + 1], idx[k + 2]].map(vert);
      const d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      const l1 = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / d;
      const l2 = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / d;
      const l3 = 1 - l1 - l2;
      if (l1 < -1e-9 || l2 < -1e-9 || l3 < -1e-9) continue;
      const want = l1 * a[2] + l2 * b[2] + l3 * c[2];
      assert.ok(Math.abs(heightAt(t, x, y) - want) < 1e-6, `(${x}, ${y}): ${heightAt(t, x, y)} vs ${want}`);
      n++;
      break;
    }
  }
  assert.ok(n > 150, `only ${n} samples fell inside the grid`);
});

test('heightAt clamps to the grid edge outside it', () => {
  const t = decodeTerrain(encodeTerrain(meta, new Float64Array([5, 5, 5, 9, 9, 9])).buffer as ArrayBuffer);
  assert.equal(heightAt(t, -1000, -1000), 5);
  assert.equal(heightAt(t, 1000, 1000), 9);
});
