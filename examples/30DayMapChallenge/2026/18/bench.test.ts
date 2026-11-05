import assert from 'node:assert/strict';
import test from 'node:test';
import { sample } from './bench.ts';
import type { NullCell } from './nullmap.ts';
import type { NullRenderer } from './renderer.ts';

test('pixel verification reads through a scratch canvas, not the rendered canvas', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'OffscreenCanvas');
  const calls: unknown[][] = [];
  const pixel = new Uint8ClampedArray([12, 34, 56, 255]);
  class ScratchCanvas {
    width: number;
    height: number;
    constructor(width: number, height: number) { this.width = width; this.height = height; }
    getContext() {
      return {
        drawImage: (...args: unknown[]) => calls.push(args),
        getImageData: () => ({ data: pixel }),
      };
    }
  }
  Object.defineProperty(globalThis, 'OffscreenCanvas', { configurable: true, value: ScratchCanvas });
  try {
    const sourceCanvas = { width: 400, clientWidth: 200 };
    let sourceReadbacks = 0;
    const sourceContext = {
      canvas: sourceCanvas,
      getImageData: () => { sourceReadbacks++; throw new Error('source canvas readback is forbidden'); },
    };
    const renderer = {
      canvas: { ...sourceCanvas, getContext: () => sourceContext },
      canvasPoint: () => ({ x: 10.9, y: 20.2 }),
    } as unknown as NullRenderer;

    assert.deepEqual(sample(renderer, { code: 'test' } as NullCell), [12, 34, 56, 255]);
    assert.equal(sourceReadbacks, 0);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]?.slice(1), [21, 40, 1, 1, 0, 0, 1, 1]);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'OffscreenCanvas', previous);
    else delete (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  }
});
