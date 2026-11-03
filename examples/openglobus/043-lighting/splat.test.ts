import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeLights, percentile, splatLights } from './splat.ts';

const W = 360, H = 180;
const at = (a: Float32Array, x: number, y: number) => a[y * W + x];

test('a place is splatted at its equirectangular pixel (x = (lon+180)/360 W, y = (90-lat)/180 H)', () => {
  const acc = splatLights([{ lon: 30.5, lat: 10.5, pop: 50000 }], W, H);
  let best = 0;
  for (let i = 1; i < acc.length; i++) if (acc[i] > acc[best]) best = i;
  assert.deepEqual([best % W, Math.floor(best / W)], [210, 79]);
});

test('the glow wraps across the antimeridian', () => {
  const acc = splatLights([{ lon: 179.9, lat: 0, pop: 1e6 }], W, H);
  assert.ok(at(acc, 0, 90) > 0.2 * at(acc, W - 1, 90), `west edge ${at(acc, 0, 90)} vs east edge ${at(acc, W - 1, 90)}`);
});

test('the glow is round on the ground: at 60 deg latitude it spans twice as many columns as rows', () => {
  const acc = splatLights([{ lon: 0.5, lat: 60.5, pop: 5e6 }], W, H);
  const cx = 180, cy = 29, peak = at(acc, cx, cy);
  let cols = 0, rows = 0;
  for (let x = 0; x < W; x++) if (at(acc, x, cy) > peak * 0.1) cols++;
  for (let y = 0; y < H; y++) if (at(acc, cx, y) > peak * 0.1) rows++;
  assert.ok(cols >= rows * 1.6 && cols <= rows * 2.6, `${cols} columns, ${rows} rows`);
});

test('a larger population glows brighter and wider', () => {
  // At the baked 2048 x 1024 (19.5 km per pixel), where the widths differ by more than a pixel.
  const w = 2048, h = 1024, x0 = 1027, y0 = 509;
  const small = splatLights([{ lon: 0.5, lat: 0.5, pop: 2000 }], w, h);
  const large = splatLights([{ lon: 0.5, lat: 0.5, pop: 2e6 }], w, h);
  assert.ok(large[y0 * w + x0] > small[y0 * w + x0] * 5);
  // Width at a tenth of the peak, so the comparison is about the spread and not the weight.
  const width = (a: Float32Array) => { let n = 0; for (let x = 0; x < w; x++) if (a[y0 * w + x] > a[y0 * w + x0] / 10) n++; return n; };
  assert.ok(width(large) > width(small) + 2, `width ${width(large)} vs ${width(small)} px`);
});

test('places sum: two towns at the same spot glow as much as their sum', () => {
  const one = splatLights([{ lon: 0.5, lat: 0.5, pop: 10000 }], W, H);
  const two = splatLights([{ lon: 0.5, lat: 0.5, pop: 10000 }, { lon: 0.5, lat: 0.5, pop: 10000 }], W, H);
  assert.ok(Math.abs(at(two, 180, 89) - 2 * at(one, 180, 89)) < 1e-6);
});

test('encoding keeps dark pixels dark, is monotonic and saturates at 255', () => {
  const acc = new Float32Array([0, 0.0001, 0.01, 0.1, 1, 10, 1000]);
  const out = encodeLights(acc, 1);
  assert.equal(out[0], 0);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1], `monotonic at ${i}`);
  assert.ok(out[1] > 0, 'a faint town (1e-4 of the scale) survives the 8-bit encoding');
  assert.equal(out[6], 255);
});

test('percentile ignores empty pixels', () => {
  const acc = new Float32Array(1000);
  for (let i = 0; i < 100; i++) acc[i] = i + 1;
  assert.equal(percentile(acc, 0.5), 51);
});
