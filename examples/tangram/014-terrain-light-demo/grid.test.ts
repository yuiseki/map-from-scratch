import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeGrid, decodeGrid, gradients, gridIndices, meshSize, lonLatToTexel, texelToLocal, HEADER_BYTES } from './grid.ts';

const meta = { w: 5, h: 4, z: 11, x0: 928000, y0: 412000, q: 0.25, cell: 31.1 };

test('a grid survives encode and decode, heights and water mask', () => {
  const qh = Int32Array.from({ length: 20 }, (_, i) => 3200 + ((i * 37) % 11) * 5 - (i % 5) * 3);
  const water = Uint8Array.from({ length: 20 }, (_, i) => (i % 3 === 0 ? 1 : 0));
  const bytes = encodeGrid({ ...meta, qh, water });
  assert.equal(bytes.length, HEADER_BYTES + 20 * 2 + 20);
  const g = decodeGrid(bytes);
  assert.deepEqual([g.w, g.h, g.z, g.x0, g.y0], [5, 4, 11, 928000, 412000]);
  assert.ok(Math.abs(g.cell - 31.1) < 1e-9);
  for (let i = 0; i < 20; i++) assert.equal(g.heights[i], qh[i] * 0.25, `height ${i}`);
  assert.deepEqual([...g.water], [...water]);
});

test('the planar predictor leaves only small residuals on a tilted plane', () => {
  // h = 100 + 7 x + 13 y: every interior residual is exactly 0
  const qh = Int32Array.from({ length: 20 }, (_, i) => 100 + 7 * (i % 5) + 13 * Math.floor(i / 5));
  const bytes = encodeGrid({ ...meta, qh, water: new Uint8Array(20) });
  const res = new Int16Array(bytes.buffer.slice(HEADER_BYTES, HEADER_BYTES + 40));
  let interior = 0;
  for (let y = 1; y < 4; y++) for (let x = 1; x < 5; x++) interior += Math.abs(res[y * 5 + x]);
  assert.equal(interior, 0);
});

test('a residual outside int16 is refused, not wrapped', () => {
  const qh = new Int32Array(20);
  qh[1] = 40000;
  assert.throws(() => encodeGrid({ ...meta, qh, water: new Uint8Array(20) }), /int16/);
});

test('gradients point uphill: east is +x, north is +y (rows run south)', () => {
  const w = 4, h = 3, cell = 10;
  const east = Float32Array.from({ length: w * h }, (_, i) => 2 * (i % w));        // +2 m per column eastwards
  const ge = gradients(east, new Uint8Array(w * h), w, h, cell);
  for (let i = 0; i < w * h; i++) { assert.ok(Math.abs(ge[i * 4] - 0.2) < 1e-6); assert.ok(Math.abs(ge[i * 4 + 1]) < 1e-6); }
  const north = Float32Array.from({ length: w * h }, (_, i) => -3 * Math.floor(i / w)); // lower to the south
  const water = new Uint8Array(w * h); water[5] = 1;
  const gn = gradients(north, water, w, h, cell);
  for (let i = 0; i < w * h; i++) { assert.ok(Math.abs(gn[i * 4 + 1] - 0.3) < 1e-6, `gy ${i} ${gn[i * 4 + 1]}`); assert.ok(Math.abs(gn[i * 4]) < 1e-6); }
  assert.equal(gn[5 * 4 + 2], 1);
  assert.equal(gn[6 * 4 + 2], 0);
});

test('the mesh covers the grid to its last texel and every triangle is in range', () => {
  const { nx, ny } = meshSize(1280, 1024, 2);
  assert.deepEqual([nx, ny], [641, 513]);   // vertex 640 sits on texel 1279 (clamped), not 1280
  const idx = gridIndices(5, 4);
  assert.equal(idx.length, 4 * 3 * 6);
  assert.equal(Math.max(...idx), 19);
  // the two triangles of the first quad share the diagonal 1-5
  assert.deepEqual([...idx.slice(0, 6)], [0, 5, 1, 1, 5, 6]);
});

test('geographic points land on the texel the bake put them on', () => {
  // z11 global pixels: lon 0 lat 0 is pixel (2^19, 2^19)
  const g = { w: 10, h: 10, z: 11, x0: 524288 - 5, y0: 524288 - 5, cell: 1 };
  const t = lonLatToTexel(0, 0, g);
  assert.ok(Math.abs(t.i - 5) < 1e-9 && Math.abs(t.j - 5) < 1e-9);
  const ne = lonLatToTexel(0.01, 0.01, g);
  assert.ok(ne.i > 5 && ne.j < 5, 'north-east is right and up in texel space');
  const p = texelToLocal(5, 5, g);           // texel corner (5, 5) is the grid centre
  assert.deepEqual([p.x, p.y], [0, 0]);
  assert.ok(texelToLocal(6, 4, g).x > 0 && texelToLocal(6, 4, g).y > 0);
});
