import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decodePcpng } from './decode.ts';

test('point cloud PNG decodes columnar signed coordinates, offsets, height and RGB', () => {
  const pixels: number[][] = [
    [1, 1, 1], [0, 0, 14], [0, 0, 0], [0, 0, 2], [0, 0, 4],
    [49, 1, 0], [0, 0, 10], [49, 1, 0], [0, 0, 20],
    [49, 0, 2], [17, 0, 0], [12, 1, 8], [0, 0, 0], [0, 0, 0],
    [255, 255, 255], [0, 0, 2], [0, 0, 3], [255, 255, 252],
    [0, 0, 125], [0, 0, 200], [10, 20, 30], [40, 50, 60],
  ];
  const rgba = new Uint8ClampedArray(pixels.flatMap(([r, g, b]) => [r, g, b, 255]));
  const result = decodePcpng(rgba, pixels.length, 1, { x: 0, y: 0, scale: 256 });
  assert.equal(result.count, 2);
  assert.deepEqual([...result.positions], [9, -23, 1.25, 12, -16, 2]);
  assert.deepEqual([...result.colors], [10, 20, 30, 40, 50, 60]);
});

test('point cloud PNG rejects unsupported projection and truncated columns', () => {
  const rgba = new Uint8ClampedArray(14 * 4);
  const set = (i: number, r: number, g: number, b: number) => rgba.set([r, g, b, 255], i * 4);
  set(0, 1, 1, 1); set(1, 0, 0, 14); set(3, 0, 0, 2);
  set(5, 49, 0, 0); set(6, 49, 0, 0); set(7, 49, 0, 0); set(8, 17, 0, 0); set(9, 12, 2, 8);
  assert.throws(() => decodePcpng(rgba, 14, 1, { x: 0, y: 0, scale: 1 }), /projection/);
  set(9, 12, 1, 8);
  assert.throws(() => decodePcpng(rgba, 14, 1, { x: 0, y: 0, scale: 1 }), /truncated/);
});
