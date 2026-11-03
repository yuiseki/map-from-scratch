import assert from 'node:assert/strict';
import test from 'node:test';
import { VancouverMap } from './renderer.ts';

const noCanvas = {} as HTMLCanvasElement;

test('Vancouver mesh rejects an incompatible binary signature before creating WebGL state', () => {
  assert.throws(() => new VancouverMap(noCanvas, new ArrayBuffer(12), []), /invalid Vancouver mesh/);
});

test('Vancouver mesh checks the packed vertex count against its payload and block table', () => {
  const buffer = new ArrayBuffer(12);
  const view = new DataView(buffer);
  for (const [i, c] of [...'VP01'].entries()) view.setUint8(i, c.charCodeAt(0));
  view.setUint32(4, 1, true);
  assert.throws(() => new VancouverMap(noCanvas, buffer, []), /mesh size mismatch/);
});
