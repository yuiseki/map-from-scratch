import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeHM01, mercatorProject, sampleColorRamp, gaussianWeight } from './heatmap.ts';

test('decodeHM01 restores bounds, count, and normalized coordinates', () => {
  const count = 3;
  const buf = new ArrayBuffer(32 + count * 6);
  const view = new DataView(buf);
  // 'HM01' = 0x31304d48 in little endian ('H'=0x48, 'M'=0x4d, '0'=0x30, '1'=0x31)
  view.setUint32(0, 0x31304d48, true);
  view.setUint32(4, count, true);
  view.setFloat32(8, 0.25, true);   // west
  view.setFloat32(12, 0.35, true);  // north
  view.setFloat32(16, 0.30, true);  // east
  view.setFloat32(20, 0.40, true);  // south
  view.setUint32(24, 60, true);     // total weight
  view.setUint32(28, 0, true);      // reserved

  // Point 0: at min corner
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 10, true);

  // Point 1: at max corner
  view.setUint16(38, 65535, true);
  view.setUint16(40, 65535, true);
  view.setUint16(42, 20, true);

  // Point 2: midway
  view.setUint16(44, 32768, true);
  view.setUint16(46, 32768, true);
  view.setUint16(48, 30, true);

  const decoded = decodeHM01(buf);
  assert.equal(decoded.count, count);
  assert.equal(decoded.totalWeight, 60);
  assert.ok(Math.abs(decoded.bounds[0] - 0.25) < 1e-5);
  assert.ok(Math.abs(decoded.bounds[1] - 0.35) < 1e-5);
  assert.ok(Math.abs(decoded.bounds[2] - 0.30) < 1e-5);
  assert.ok(Math.abs(decoded.bounds[3] - 0.40) < 1e-5);
  assert.equal(decoded.points.length, count);

  // Check point 0
  assert.ok(Math.abs(decoded.points[0].x - 0.25) < 1e-5);
  assert.ok(Math.abs(decoded.points[0].y - 0.35) < 1e-5);
  assert.equal(decoded.points[0].weight, 10);

  // Check point 1
  assert.ok(Math.abs(decoded.points[1].x - 0.30) < 1e-5);
  assert.ok(Math.abs(decoded.points[1].y - 0.40) < 1e-5);
  assert.equal(decoded.points[1].weight, 20);
});

test('decodeHM01 rejects invalid magic and truncated buffers', () => {
  const badMagic = new ArrayBuffer(32);
  new DataView(badMagic).setUint32(0, 0x12345678, true);
  assert.throws(() => decodeHM01(badMagic), /invalid heatmap header/);

  const truncated = new ArrayBuffer(20);
  assert.throws(() => decodeHM01(truncated), /too short/);

  const lengthMismatch = new ArrayBuffer(32 + 6);
  const view = new DataView(lengthMismatch);
  view.setUint32(0, 0x31304d48, true);
  view.setUint32(4, 5, true); // expects 5 points = 30 bytes, but only has 6
  assert.throws(() => decodeHM01(lengthMismatch), /truncated heatmap data/);
});

test('mercatorProject maps longitude and latitude to [0, 1] unit square', () => {
  const center = mercatorProject(0, 0);
  assert.ok(Math.abs(center.x - 0.5) < 1e-6);
  assert.ok(Math.abs(center.y - 0.5) < 1e-6);

  const tokyo = mercatorProject(139.6917, 35.6895);
  assert.ok(tokyo.x > 0.88 && tokyo.x < 0.90);
  assert.ok(tokyo.y > 0.38 && tokyo.y < 0.40);
});

test('gaussianWeight evaluates exp(-4 * d^2 / r^2)', () => {
  const center = gaussianWeight(0, 100);
  assert.equal(center, 1.0);

  const atEdge = gaussianWeight(100, 100);
  assert.ok(Math.abs(atEdge - Math.exp(-4)) < 1e-6);

  const outside = gaussianWeight(105, 100);
  assert.equal(outside, 0.0);
});

test('sampleColorRamp returns expected RGB values across spectrum', () => {
  const c0 = sampleColorRamp(0.0);
  // low values: dark blue / navy
  assert.ok(c0.r < 0.2 && c0.g < 0.3 && c0.b > 0.3);

  const cMid = sampleColorRamp(0.5);
  // mid values: green / yellow
  assert.ok(cMid.g > 0.7);

  const c1 = sampleColorRamp(1.0);
  // high values: bright red
  assert.ok(c1.r > 0.9 && c1.b < 0.4);
});
