import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeCountryGeometry, encodeCountryGeometry, simplifyRing } from './geometry.ts';

test('small island rings retain their original vertices when pixel simplification would erase them', () => {
  const triangle: [number, number][] = [[0, 0], [0.001, 0], [0, 0.001], [0, 0]];
  const result = simplifyRing(triangle, 1, (point) => point);
  assert.equal(result.length, 3);
  assert.deepEqual(result, triangle.slice(0, -1));
});

test('large rings are simplified without dropping their geographic closure', () => {
  const square: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
  const result = simplifyRing(square, 0.1, (point) => point);
  assert.equal(result.length, 4);
  assert.notDeepEqual(result[0], result.at(-1));
});

test('EQG1 packs normalized country rings into quantized coordinates with metadata offsets', () => {
  const input = [{ iso3: 'JPN', name: 'Japan', label: [0.8, 0.4] as [number, number], rings: [
    [[0.7, 0.3], [0.9, 0.3], [0.8, 0.5]],
  ] }];
  const packed = encodeCountryGeometry(input);
  assert.equal(packed.buffer.byteLength, 8 + 3 * 4);
  const decoded = decodeCountryGeometry(packed.buffer, packed.metadata);
  assert.equal(decoded[0]!.iso3, 'JPN');
  assert.equal(decoded[0]!.rings[0]!.length, 3);
  assert.ok(Math.abs(decoded[0]!.rings[0]![2]![0] - 0.8) < 0.00002);
});

test('EQG1 rejects out-of-range geometry and invalid ring offsets', () => {
  assert.throws(() => encodeCountryGeometry([{ iso3: 'JPN', name: 'Japan', label: [0.5, 0.5], rings: [[[0, 0], [2, 0], [0, 1]]] }]), /normalized/i);
  const packed = encodeCountryGeometry([{ iso3: 'JPN', name: 'Japan', label: [0.5, 0.5], rings: [[[0, 0], [1, 0], [0, 1]]] }]);
  assert.throws(() => decodeCountryGeometry(packed.buffer, [{ ...packed.metadata[0]!, rings: [{ offset: 2, count: 5 }] }]), /offset/i);
});
