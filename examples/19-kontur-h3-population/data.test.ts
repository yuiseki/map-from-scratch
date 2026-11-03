import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readCells, type PathBuilder } from './data.ts';

class PathRecorder implements PathBuilder {
  commands: unknown[][] = [];
  moveTo(x: number, y: number): void { this.commands.push(['moveTo', x, y]); }
  lineTo(x: number, y: number): void { this.commands.push(['lineTo', x, y]); }
  closePath(): void { this.commands.push(['closePath']); }
}

function dataset(): ArrayBuffer {
  const bytes = new Uint8Array(8 + 8 + 4 + 1 + 1 + 3 * 4);
  bytes.set([72, 51, 80, 49]);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setBigUint64(8, 0xabcdefn, true);
  view.setUint32(16, 501, true);
  bytes[20] = 1; bytes[21] = 3;
  view.setUint16(22, 10, true); view.setUint16(24, 20, true);
  view.setUint16(26, 30, true); view.setUint16(28, 15, true);
  view.setUint16(30, 20, true); view.setUint16(32, 40, true);
  return bytes.buffer;
}

test('H3P1 reader decodes cell id, population, ring bounds and path commands', () => {
  const paths = Array.from({ length: 9 }, () => new PathRecorder());
  const [cell] = readCells(dataset(), paths);
  assert.deepEqual(cell, {
    h3: 'abcdef', population: 501,
    rings: [[[10, 20], [30, 15], [20, 40]]],
    box: [10, 15, 30, 40],
  });
  assert.deepEqual(paths[3].commands, [['moveTo', 10, 20], ['lineTo', 30, 15], ['lineTo', 20, 40], ['closePath']]);
  assert.equal(paths[0].commands.length, 0);
});

test('H3P1 reader rejects incompatible signatures and trailing bytes', () => {
  const paths = Array.from({ length: 9 }, () => new PathRecorder());
  const badMagic = dataset().slice(0); new Uint8Array(badMagic)[0] = 0;
  assert.throws(() => readCells(badMagic, paths), /version mismatch/);
  const trailing = new Uint8Array(dataset().byteLength + 1); trailing.set(new Uint8Array(dataset()));
  assert.throws(() => readCells(trailing.buffer, paths), /trailing bytes/);
});
