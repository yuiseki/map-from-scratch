import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, HEADER_BYTES, MAGIC, UNIT_M, VERTEX_BYTES, bandOf, decode, encode, ringEdges } from './format.ts';

test('bandOf rings outward from the centre: the first edge the distance is below, the last band holding the rest', () => {
  const edges = Array.from({ length: BANDS }, (_, i) => 75 * (i + 1));
  assert.equal(bandOf(0, 0, edges), 0);
  assert.equal(bandOf(74, 0, edges), 0);
  assert.equal(bandOf(0, 76, edges), 1);
  assert.equal(bandOf(-75 * 5.5, 0, edges), 5);
  assert.equal(bandOf(5000, 0, edges), BANDS - 1);
  // Same distance, different direction: same band (rings, not sectors).
  assert.equal(bandOf(75 * 3.2, 0, edges), bandOf(0, -75 * 3.2, edges));
});

test('ringEdges puts the same number of buildings in every band', () => {
  // Dense centre, sparse rim: equal-width rings would be very uneven.
  const d = Array.from({ length: 1600 }, (_, i) => Math.sqrt(i) * 40);
  const edges = ringEdges(d);
  assert.equal(edges.length, BANDS);
  const count = new Array(BANDS).fill(0);
  for (const r of d) count[bandOf(r, 0, edges)]++;
  assert.deepEqual(count, new Array(BANDS).fill(100));
  for (let i = 1; i < BANDS; i++) assert.ok(edges[i] > edges[i - 1]);
});

test('encode and decode round-trip the vertices, indices and header', () => {
  const verts = [
    { x: -12.34, y: 56.78, h: 0, band: 0, top: 0 },
    { x: -12.34, y: 56.78, h: 241.5, band: 3, top: 1 },
    { x: 1500, y: -1500, h: 6.2, band: 15, top: 1 },
  ];
  const idx = [0, 1, 2, 2, 1, 0];
  const edges = Array.from({ length: BANDS }, (_, i) => 100 * (i + 1));
  const buf = encode({ edges, buildings: 2, verts, indices: idx });
  assert.equal(buf.byteLength, HEADER_BYTES + verts.length * VERTEX_BYTES + idx.length * 4);
  assert.equal(new TextDecoder().decode(new Uint8Array(buf, 0, 4)), MAGIC);
  const d = decode(buf);
  assert.equal(d.vertexCount, 3);
  assert.deepEqual([...d.edges], edges);
  assert.equal(d.buildings, 2);
  assert.deepEqual([...d.indices], idx);
  const xy = new Int16Array(d.vertices.buffer, d.vertices.byteOffset, d.vertices.byteLength / 2);
  const u8 = new Uint8Array(d.vertices.buffer, d.vertices.byteOffset, d.vertices.byteLength);
  verts.forEach((v, i) => {
    assert.ok(Math.abs(xy[i * 4] * UNIT_M - v.x) <= UNIT_M / 2, `x ${i}`);
    assert.ok(Math.abs(xy[i * 4 + 1] * UNIT_M - v.y) <= UNIT_M / 2, `y ${i}`);
    const h = u8[i * 8 + 4] | (u8[i * 8 + 5] << 8);
    assert.ok(Math.abs(h * UNIT_M - v.h) <= UNIT_M / 2, `h ${i}`);
    assert.equal(u8[i * 8 + 6], v.band);
    assert.equal(u8[i * 8 + 7], v.top);
  });
});

test('decode refuses a file with the wrong magic', () => {
  const buf = encode({ edges: [], buildings: 0, verts: [], indices: [] });
  new Uint8Array(buf)[0] = 0x58;
  assert.throws(() => decode(buf), /magic/);
});

test('encode refuses coordinates that do not fit 16 bits', () => {
  assert.throws(() => encode({ edges: [], buildings: 1, verts: [{ x: 4000, y: 0, h: 0, band: 0, top: 0 }], indices: [] }), /16 bit/);
});
