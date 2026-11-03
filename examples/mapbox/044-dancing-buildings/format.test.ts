import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, MAGIC, UNIT_M, VERTEX_BYTES, bandOf, decode, encode, ringEdges, type Building } from './format.ts';

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

const EDGES = Array.from({ length: BANDS }, (_, i) => 100 * (i + 1));
// A 20 m x 10 m box, 35.6 m tall, band 1, and an L-shaped courtyard block
// (outer ring and a hole), 12.3 m tall, band 15, far away.
const box: Building = { height: 35.6, band: 1, polys: [{ rings: [[100, 50, 120, 50, 120, 60, 100, 60]], roof: [1, 2, 3, 3, 0, 1] }] };
const court: Building = {
  height: 12.3, band: 15,
  polys: [{
    rings: [[-1500, -1500, -1460, -1500, -1460, -1460, -1500, -1460], [-1490, -1490, -1490, -1470, -1470, -1470, -1470, -1490]],
    roof: [0, 4, 5, 0, 1, 4, 1, 7, 4, 1, 2, 7, 2, 6, 7, 2, 3, 6, 3, 5, 6, 3, 0, 5],
  }],
};

interface V { x: number; y: number; h: number; band: number; top: number }
function vertices(d: ReturnType<typeof decode>): V[] {
  const dv = new DataView(d.vertices.buffer, d.vertices.byteOffset, d.vertices.byteLength);
  return Array.from({ length: d.vertexCount }, (_, i) => ({
    x: dv.getInt16(i * VERTEX_BYTES, true) * UNIT_M,
    y: dv.getInt16(i * VERTEX_BYTES + 2, true) * UNIT_M,
    h: dv.getUint16(i * VERTEX_BYTES + 4, true) * UNIT_M,
    band: dv.getUint8(i * VERTEX_BYTES + 6),
    top: dv.getUint8(i * VERTEX_BYTES + 7),
  }));
}

test('decode rebuilds a bottom and a top vertex per corner, carrying height and band, from the shipped corners', () => {
  const d = decode(encode(EDGES, [box]));
  assert.equal(new TextDecoder().decode(new Uint8Array(encode(EDGES, [box]), 0, 4)), MAGIC);
  assert.equal(d.buildings, 1);
  assert.deepEqual([...d.edges], EDGES);
  const v = vertices(d);
  assert.equal(v.length, 8);
  assert.deepEqual(v.map((p) => p.top), [0, 0, 0, 0, 1, 1, 1, 1]);
  const xy = box.polys[0].rings[0];
  v.forEach((p, i) => {
    assert.ok(Math.abs(p.x - xy[(i % 4) * 2]) <= UNIT_M / 2 && Math.abs(p.y - xy[(i % 4) * 2 + 1]) <= UNIT_M / 2, `corner ${i}`);
    assert.ok(Math.abs(p.h - 35.6) <= UNIT_M / 2 && p.band === 1);
  });
});

test('decode rebuilds two wall triangles per edge spanning ground and roof, then the shipped roof on the top vertices', () => {
  const d = decode(encode(EDGES, [box]));
  const v = vertices(d), idx = [...d.indices];
  assert.equal(idx.length, 4 * 6 + 6);
  for (let q = 0; q < 4; q++) {
    const quad = idx.slice(q * 6, q * 6 + 6);
    assert.ok(quad.some((k) => v[k].top === 0) && quad.some((k) => v[k].top === 1), `wall ${q}`);
    // The wall of edge q joins corners q and q + 1 (mod 4).
    assert.deepEqual([...new Set(quad.map((k) => k % 4))].sort(), [q, (q + 1) % 4].sort());
  }
  assert.deepEqual(idx.slice(24), box.polys[0].roof.map((k) => 4 + k));
});

test('holes get walls too, and later buildings are offset', () => {
  const d = decode(encode(EDGES, [box, court]));
  const v = vertices(d), idx = [...d.indices];
  assert.equal(d.buildings, 2);
  assert.equal(v.length, 8 + 16);
  // box: 24 + 6; court: 8 edges x 6 + 24 roof.
  assert.equal(idx.length, 30 + 48 + 24);
  const courtIdx = idx.slice(30);
  assert.ok(courtIdx.every((k) => k >= 8));
  assert.ok(v.slice(8).every((p) => p.band === 15 && Math.abs(p.h - 12.3) <= UNIT_M / 2));
  // The hole's corners (court corners 4..7) appear in walls.
  const walls = courtIdx.slice(0, 48).map((k) => (k - 8) % 8);
  for (const c of [4, 5, 6, 7]) assert.ok(walls.includes(c), `hole corner ${c}`);
  assert.ok(Math.abs(v[8 + 4].x - -1490) <= UNIT_M / 2 && Math.abs(v[8 + 4].y - -1490) <= UNIT_M / 2);
});

test('the shipped file is small: no top vertices, no wall indices, corners delta-coded', () => {
  const many: Building[] = Array.from({ length: 200 }, (_, i) => ({ ...box, polys: [{ ...box.polys[0], rings: [box.polys[0].rings[0].map((c) => c + i * 3)] }] }));
  const buf = encode(EDGES, many);
  const d = decode(buf);
  // What decode builds: 8 vertices x 8 B + 30 indices x 4 B per building.
  assert.ok(buf.byteLength < (d.vertexCount * VERTEX_BYTES + d.indices.length * 4) / 4, `${buf.byteLength} B`);
});

test('decode refuses a file with the wrong magic, encode refuses coordinates beyond 16 bits', () => {
  const buf = encode(EDGES, [box]);
  new Uint8Array(buf)[0] = 0x58;
  assert.throws(() => decode(buf), /magic/);
  assert.throws(() => encode(EDGES, [{ ...box, polys: [{ rings: [[4000, 0, 4001, 0, 4001, 1]], roof: [0, 1, 2] }] }]), /16 bit/);
});
