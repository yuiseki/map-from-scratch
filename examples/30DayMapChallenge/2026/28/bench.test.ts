import assert from 'node:assert/strict';
import test from 'node:test';
import { canvasPalette } from './bench.ts';
import { GREEN_BAND_COLORS } from './feeling.ts';

test('canvas palette verification copies pixels before reading them', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const hex = GREEN_BAND_COLORS[0]!;
  const pixel = new Uint8ClampedArray(hex.slice(1).match(/../g)!.map((part) => Number.parseInt(part, 16)).concat(255));
  const calls: unknown[][] = [];
  class ScratchCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage: (...args: unknown[]) => calls.push(args),
        getImageData: () => ({ data: pixel, width: this.width, height: this.height }),
      };
    }
  }
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: ScratchCanvas });
  try {
    const sourceCanvas = { width: 1, height: 1 };
    let sourceReadbacks = 0;
    const sourceContext = {
      canvas: sourceCanvas,
      getImageData: () => { sourceReadbacks++; throw new Error('source canvas readback is forbidden'); },
    };
    const palette = canvasPalette({ ...sourceCanvas, getContext: () => sourceContext } as unknown as HTMLCanvasElement);

    assert.equal(palette.counts[0], 1);
    assert.deepEqual(palette.extent, [0, 0, 0, 0]);
    assert.equal(sourceReadbacks, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(1), [0, 0, 1, 1, 0, 0, 1, 1]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  }
});
