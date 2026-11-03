import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeLines, decodeLines, encodeLand, decodeLand } from './format.ts';

test('lines survive the round trip to within 1e-6 degrees, in order and per line', () => {
  const lines = [[[139.7671, 35.6812], [139.6, 35.5], [138.66346, 35.14213]], [[130.4206, 33.5897], [130.5, 33.0]]];
  const out = decodeLines(encodeLines(lines).buffer as ArrayBuffer);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((l) => l.length / 2), [3, 2]);
  lines.flat().forEach(([lon, lat], i) => {
    const all = Array.from(out[0]).concat(Array.from(out[1]));
    assert.ok(Math.abs(all[i * 2] - lon) < 1e-6 && Math.abs(all[i * 2 + 1] - lat) < 1e-6);
  });
});

test('delta coding keeps the file small for dense lines', () => {
  const line: number[][] = [];
  for (let i = 0; i < 1000; i++) line.push([135 + i * 1e-3, 35 + i * 5e-4]);
  const bytes = encodeLines([line]).byteLength;
  assert.ok(bytes <= 8 + 4 + 1000 * 8, `${bytes} bytes`);
});

test('land triangles: vertices and indices come back, two layers', () => {
  const layers = [
    { vertices: [120, 30, 121, 30, 120.5, 31], indices: [0, 1, 2] },
    { vertices: [-10, -5, 10, -5, 0, 5, 0, -20], indices: [0, 1, 2, 0, 3, 1] },
  ];
  const out = decodeLand(encodeLand(layers).buffer as ArrayBuffer);
  assert.equal(out.length, 2);
  assert.deepEqual(Array.from(out[1].indices), [0, 1, 2, 0, 3, 1]);
  out.forEach((l, k) => layers[k].vertices.forEach((v, i) => assert.ok(Math.abs(l.vertices[i] - v) < 1e-4)));
});
