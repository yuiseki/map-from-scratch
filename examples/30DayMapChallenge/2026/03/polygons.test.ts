import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeCountryMesh, populationClass, projectEqualEarth } from './polygons.ts';

test('Equal Earth projection keeps the equator centered and reverses neither axis', () => {
  assert.deepEqual(projectEqualEarth(0, 0), [0, 0]);
  assert.ok(projectEqualEarth(90, 0)[0] > 0);
  assert.ok(projectEqualEarth(0, 60)[1] > 0);
});

test('population colors increase monotonically on a logarithmic scale with a distinct no-data class', () => {
  assert.equal(populationClass(null, 10, 1_000_000_000), 0);
  assert.equal(populationClass(0, 10, 1_000_000_000), 0);
  assert.equal(populationClass(10, 10, 1_000_000_000), 1);
  assert.ok(populationClass(10_000, 10, 1_000_000_000) > populationClass(100, 10, 1_000_000_000));
  assert.equal(populationClass(1_000_000_000, 10, 1_000_000_000), 255);
  assert.equal(populationClass(2_000_000_000, 10, 1_000_000_000), 255);
});

test('GPC1 mesh encodes projected positions, class values, triangles, and country borders', () => {
  const encoded = encodeCountryMesh({
    vertices: [[0, 0, 1], [65535, 0, 255], [0, 65535, 0]],
    triangles: [0, 1, 2],
    borders: [[0, 1], [1, 2]],
  });
  const view = new DataView(encoded);
  assert.equal(String.fromCharCode(...new Uint8Array(encoded, 0, 4)), 'GPC1');
  assert.equal(view.getUint32(4, true), 3);
  assert.equal(view.getUint32(8, true), 3);
  assert.equal(view.getUint32(12, true), 2);
  assert.equal(encoded.byteLength, 16 + 18 + 12 + 16);
  assert.equal(view.getUint16(16 + 6, true), 65535);
  assert.equal(view.getUint8(16 + 6 + 4), 255);
  assert.equal(view.getUint32(16 + 18 + 12 + 12, true), 2);
});
