import assert from 'node:assert/strict';
import test from 'node:test';
import { ShadowRelief } from './relief.ts';

test('shadow comparison round-trips map texels through screen coordinates', () => {
  const relief = Object.create(ShadowRelief.prototype) as ShadowRelief;
  Object.assign(relief, {
    canvas: { width: 800, height: 600 }, dpr: 1, zoom: 1,
    center: { u: 0.5, v: 0.5 }, meta: { width: 100, height: 100 },
  });
  assert.deepEqual(relief.screenOf(0.5, 0.5), [400, 300]);
  const screen = relief.screenOf(0.25, 0.75);
  assert.deepEqual(screen, [200, 500]);
  assert.deepEqual(relief.uvAtScreen(...screen), [0.25, 0.75]);
});

test('shadow comparison clamps split position to the image bounds', () => {
  const relief = Object.create(ShadowRelief.prototype) as ShadowRelief;
  Object.assign(relief, { split: 0.5, draw: () => {} });
  relief.setSplit(-1);
  assert.equal(relief.split, 0);
  relief.setSplit(2);
  assert.equal(relief.split, 1);
});
