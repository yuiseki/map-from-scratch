import assert from 'node:assert/strict';
import test from 'node:test';
import { cellAreaKm2, decodeUrbanCells, encodeUrbanCells, URBAN_EXTENT, URBAN_RECORD_BYTES, urbanMetrics, type UrbanCell } from './urban.ts';

test('GHSL 30 arc-second cell area reflects the shrinking east-west width with latitude', () => {
  const equator = cellAreaKm2(0);
  const Tokyo = cellAreaKm2(35.7);
  assert.ok(equator > 0.85 && equator < 0.87);
  assert.ok(Tokyo > 0.68 && Tokyo < 0.71);
  assert.ok(Tokyo < equator);
});

test('urban metrics express residential density per square kilometre and built surface share', () => {
  const metrics = urbanMetrics(35.7, 70, 350_000);
  assert.ok(metrics.populationPerKm2 > 100 && metrics.populationPerKm2 < 102);
  assert.ok(metrics.builtShare > 0.49 && metrics.builtShare < 0.51);
});

test('URB2 stores compact quantized geographic observations as fixed-width records', () => {
  const cells: UrbanCell[] = [
    { longitude: 139.7, latitude: 35.7, population: 25.5, builtSurfaceM2: 120_000 },
    { longitude: 140.1, latitude: 36.2, population: 0, builtSurfaceM2: 32_000 },
  ];
  const bytes = encodeUrbanCells(cells, URBAN_EXTENT);
  assert.equal(String.fromCharCode(...new Uint8Array(bytes, 0, 4)), 'URB2');
  assert.equal(new DataView(bytes).getUint32(4, true), 2);
  assert.equal(bytes.byteLength, 8 + 2 * URBAN_RECORD_BYTES);
  const decoded = decodeUrbanCells(bytes, URBAN_EXTENT);
  assert.equal(decoded.length, 8);
  assert.ok(Math.abs(decoded[0]! - 139.7) < (URBAN_EXTENT.east - URBAN_EXTENT.west) / 65535);
  assert.equal(decoded[6], 0);
  assert.equal(decoded[7], 32_000);
  assert.equal(decoded[2], 26);
});

test('URB2 keeps positive sub-unit source values distinguishable from empty cells', () => {
  const bytes = encodeUrbanCells([
    { longitude: 139, latitude: 35, population: 0.2, builtSurfaceM2: 0.1 },
  ], URBAN_EXTENT);
  const [longitude, latitude, population, built] = decodeUrbanCells(bytes, URBAN_EXTENT);
  assert.ok(longitude! > 0 && latitude! > 0);
  assert.equal(population, 1);
  assert.equal(built, 10);
});

test('URB2 rejects malformed files and invalid source values', () => {
  assert.throws(() => decodeUrbanCells(new ArrayBuffer(7), URBAN_EXTENT), /header/);
  assert.throws(() => encodeUrbanCells([{ longitude: 1, latitude: 2, population: -1, builtSurfaceM2: 0 }], URBAN_EXTENT), /nonnegative/);
});
