import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodeMvt } from './mvt.ts';

const varint = (n: number): number[] => {
  const out: number[] = [];
  do { let byte = n % 128; n = Math.floor(n / 128); if (n) byte |= 128; out.push(byte); } while (n);
  return out;
};
const field = (id: number, bytes: number[]) => [...varint((id << 3) | 2), ...varint(bytes.length), ...bytes];
const utf8 = (value: string) => [...new TextEncoder().encode(value)];

test('MVT polygon commands and string properties decode from protobuf', () => {
  const geometry = [9, 0, 0, 26, 20, 0, 0, 20, 19, 0, 15];
  const feature = [...field(2, [0, 0]), 24, 3, ...field(4, geometry)];
  const layer = [...field(1, utf8('water')), ...field(2, feature), ...field(3, utf8('class')),
    ...field(4, field(1, utf8('lake'))), 40, 128, 4];
  const tile = new Uint8Array(field(3, layer));
  const decoded = decodeMvt(tile);
  assert.equal(decoded.length, 1);
  assert.equal(decoded[0].name, 'water');
  assert.equal(decoded[0].extent, 512);
  assert.deepEqual(decoded[0].features[0].properties, { class: 'lake' });
  assert.deepEqual(decoded[0].features[0].paths, [[[0, 0], [10, 0], [10, 10], [0, 10]]]);
});

test('unselected layers skip their malformed feature geometry', () => {
  const unrelated = [...field(1, utf8('building')), ...field(2, [24, 3, ...field(4, [255])])];
  assert.deepEqual(decodeMvt(new Uint8Array(field(3, unrelated))), []);
});
