import assert from 'node:assert/strict';
import test from 'node:test';
import { arcPoint, decodeArcData, flowColor, projectMercator } from './arc.ts';

test('Mercator projection maps world bounds accurately', () => {
  assert.deepEqual(projectMercator(0, 0), [0.5, 0.5]);
  assert.equal(projectMercator(-180, 0)[0], 0);
  assert.equal(projectMercator(180, 0)[0], 1);
  assert.ok(projectMercator(0, 45)[1] < 0.5);
  assert.ok(projectMercator(0, -45)[1] > 0.5);
});

test('arc 3D parabola calculates midpoint peak and ground endpoints', () => {
  const p0: [number, number] = [0, 0];
  const p1: [number, number] = [10, 0];
  const maxH = 50;

  const start = arcPoint(p0, p1, 0.0, maxH);
  assert.deepEqual(start, [0, 0, 0]);

  const mid = arcPoint(p0, p1, 0.5, maxH);
  assert.deepEqual(mid, [5, 0, 50]);

  const end = arcPoint(p0, p1, 1.0, maxH);
  assert.deepEqual(end, [10, 0, 0]);

  const q1 = arcPoint(p0, p1, 0.25, maxH);
  assert.equal(q1[2], 50 * 4 * 0.25 * 0.75); // 37.5
});

test('flowColor interpolates RGBA across arc parameter t', () => {
  const c0 = flowColor(100, 0.0);
  const c1 = flowColor(100, 1.0);
  assert.equal(c0.length, 4);
  assert.equal(c1.length, 4);
  // Alpha should be non-zero
  assert.ok(c0[3] > 0);
  assert.ok(c1[3] > 0);
  // Source and target should differ in color hue
  assert.notDeepEqual(c0.slice(0, 3), c1.slice(0, 3));
});

test('decodeArcData parses DARC binary header and structures', () => {
  // Construct minimal valid DARC binary
  const countyCount = 2;
  const flowCount = 1;
  const ringCount = 1;
  const ptCount = 3;
  const nameStr = 'CountyA\0CountyB\0';
  const nameBytes = new TextEncoder().encode(nameStr);

  const headerSize = 32;
  const centroidsSize = countyCount * 2 * 4;
  const flowsSize = flowCount * 8;
  const ringsSize = 4 + ptCount * 2 * 4;
  const totalSize = headerSize + centroidsSize + flowsSize + ringsSize + nameBytes.length;

  const buffer = new ArrayBuffer(totalSize);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Header 'DARC'
  u8[0] = 68; u8[1] = 65; u8[2] = 82; u8[3] = 67;
  view.setUint16(4, 1, true); // version
  view.setUint16(6, countyCount, true);
  view.setUint32(8, flowCount, true);
  view.setUint16(12, ringCount, true);
  view.setUint32(14, nameBytes.length, true);

  let off = headerSize;
  // Centroids
  view.setFloat32(off, -122.4, true); view.setFloat32(off + 4, 37.7, true); off += 8;
  view.setFloat32(off, -118.2, true); view.setFloat32(off + 4, 34.0, true); off += 8;

  // Flows: s=0, t=1, v=500
  view.setUint16(off, 0, true);
  view.setUint16(off + 2, 1, true);
  view.setInt32(off + 4, 500, true);
  off += 8;

  // Ring
  view.setUint32(off, ptCount, true); off += 4;
  for (let i = 0; i < ptCount; i++) {
    view.setFloat32(off, i * 1.0, true);
    view.setFloat32(off + 4, i * 2.0, true);
    off += 8;
  }

  // Names
  u8.set(nameBytes, off);

  const decoded = decodeArcData(buffer);
  assert.equal(decoded.countyCount, 2);
  assert.equal(decoded.flowCount, 1);
  assert.equal(decoded.names.length, 2);
  assert.equal(decoded.names[0], 'CountyA');
  assert.equal(decoded.names[1], 'CountyB');
  assert.equal(decoded.flows[0].v, 500);
  assert.equal(decoded.landRings.length, 1);
  assert.equal(decoded.landRings[0].length, 6);
});
