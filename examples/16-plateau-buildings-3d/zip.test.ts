import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dataStart, endRecord, entries, memberRange, meshOf, SLACK } from './zip.ts';

function u16(bytes: Uint8Array, at: number, value: number): void { new DataView(bytes.buffer).setUint16(at, value, true); }
function u32(bytes: Uint8Array, at: number, value: number): void { new DataView(bytes.buffer).setUint32(at, value, true); }

test('classic ZIP end record and central-directory entries yield member metadata', () => {
  const tail = new Uint8Array(22);
  u32(tail, 0, 0x06054b50); u16(tail, 10, 1); u32(tail, 12, 57); u32(tail, 16, 100);
  assert.deepEqual(endRecord(tail, 200), { cdOff: 100, cdLen: 57, count: 1 });

  const name = new TextEncoder().encode('udx/bldg/53394611_bldg_6697_op.gml');
  const cd = new Uint8Array(46 + name.length);
  u32(cd, 0, 0x02014b50); u16(cd, 10, 8); u32(cd, 16, 0x12345678);
  u32(cd, 20, 40); u32(cd, 24, 90); u16(cd, 28, name.length); u32(cd, 42, 1234);
  cd.set(name, 46);
  const [entry] = entries(cd);
  assert.deepEqual(entry, { name: 'udx/bldg/53394611_bldg_6697_op.gml', method: 8, crc: 0x12345678, compSize: 40, size: 90, headerOff: 1234, extraLen: 0 });
  assert.deepEqual(memberRange(entry), [1234, 1234 + 30 + name.length * 3 + SLACK + 40]);
  assert.equal(meshOf(entry.name), '53394611');
});

test('ZIP reader rejects missing signatures and identifies local member data', () => {
  assert.throws(() => endRecord(new Uint8Array(30), 30), /no end of central directory/);
  assert.throws(() => dataStart(new Uint8Array(30)), /bad local header/);
  const local = new Uint8Array(35);
  u32(local, 0, 0x04034b50); u16(local, 26, 3); u16(local, 28, 2);
  assert.equal(dataStart(local), 35);
  assert.equal(meshOf('udx/bldg/53394611_bldg_6697_extra_op.gml'), '53394611');
  assert.equal(meshOf('udx/bldg/5339461_bldg_6697_op.gml'), null);
});
