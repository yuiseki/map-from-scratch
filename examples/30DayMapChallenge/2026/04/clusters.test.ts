import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyFacility, encodeFacilities, encodeOutline, type Facility } from './clusters.ts';

test('OSM point tags are assigned to food, retail, mobility, or civic and visitor clusters', () => {
  assert.equal(classifyFacility({ amenity: 'cafe' }), 0);
  assert.equal(classifyFacility({ shop: 'convenience' }), 1);
  assert.equal(classifyFacility({ public_transport: 'platform' }), 2);
  assert.equal(classifyFacility({ amenity: 'clinic' }), 3);
  assert.equal(classifyFacility({ tourism: 'museum' }), 3);
  assert.equal(classifyFacility({ building: 'yes' }), null);
});

test('specific facility categories win over broad secondary tags', () => {
  assert.equal(classifyFacility({ amenity: 'restaurant', shop: 'yes' }), 0);
  assert.equal(classifyFacility({ railway: 'station', tourism: 'yes' }), 2);
});

test('TFC1 encodes normalized coordinates and category in aligned six-byte records', () => {
  const points: Facility[] = [
    { x: 100, y: 400, kind: 0 },
    { x: 200, y: 300, kind: 3 },
  ];
  const encoded = encodeFacilities(points, { minX: 100, minY: 300, maxX: 200, maxY: 400 });
  const view = new DataView(encoded);
  assert.equal(String.fromCharCode(...new Uint8Array(encoded, 0, 4)), 'TFC1');
  assert.equal(view.getUint32(4, true), 2);
  assert.equal(encoded.byteLength, 8 + 12);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), 0);
  assert.equal(view.getUint8(12), 0);
  assert.equal(view.getUint16(14, true), 65535);
  assert.equal(view.getUint16(16, true), 65535);
  assert.equal(view.getUint8(18), 3);
});

test('TFC1 rejects invalid bounds and coordinates outside the declared extent', () => {
  assert.throws(() => encodeFacilities([], { minX: 1, minY: 0, maxX: 1, maxY: 1 }), /bounds/);
  assert.throws(() => encodeFacilities([{ x: 2, y: 0, kind: 0 }], { minX: 0, minY: 0, maxX: 1, maxY: 1 }), /extent/);
});

test('TBO1 encodes each closed city-boundary ring as independent GPU line segments', () => {
  const encoded = encodeOutline([[ [0, 0], [10, 0], [10, 10], [0, 0] ]], { minX: 0, minY: 0, maxX: 10, maxY: 10 });
  const view = new DataView(encoded);
  assert.equal(String.fromCharCode(...new Uint8Array(encoded, 0, 4)), 'TBO1');
  assert.equal(view.getUint32(4, true), 3);
  assert.equal(encoded.byteLength, 8 + 3 * 8);
  assert.equal(view.getUint16(8, true), 0);
  assert.equal(view.getUint16(10, true), 65535);
  assert.equal(view.getUint16(12, true), 65535);
  assert.equal(view.getUint16(14, true), 65535);
});
