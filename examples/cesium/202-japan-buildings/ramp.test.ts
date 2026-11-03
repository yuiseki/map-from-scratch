import assert from 'node:assert/strict';
import { test } from 'node:test';
import { STOPS, rampGlsl, rampCss, LAND, OCEAN, SKY, rgbOf } from './ramp.ts';

const lum = ([r, g, b]: number[]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const chroma = ([r, g, b]: number[]) => { const s = r + g + b; return [r / s, g / s, b / s]; };

test('the ramp the shader uses is exactly STOPS: parse the generated GLSL back', () => {
  const src = rampGlsl();
  const heights = [...src.matchAll(/\(h - ([\d.]+)\) \/ ([\d.]+)/g)].map((m) => [+m[1], +m[1] + +m[2]]);
  const colours = [...src.matchAll(/vec3\(([\d.]+), ([\d.]+), ([\d.]+)\)/g)].map((m) => [+m[1], +m[2], +m[3]].map((v) => Math.round(v * 255)));
  assert.equal(colours.length, STOPS.length);
  STOPS.forEach(([, c], i) => assert.deepEqual(colours[i], c, `stop ${i}`));
  heights.forEach(([h0, h1], i) => {
    assert.ok(Math.abs(h0 - STOPS[i][0]) < 1e-9 && Math.abs(h1 - STOPS[i + 1][0]) < 1e-9, `segment ${i}: ${h0}..${h1}`);
  });
  assert.equal(heights.length, STOPS.length - 1);
});

test('taller is darker and redder: luminance falls at every stop, so a pixel check can order buildings by height', () => {
  for (let i = 1; i < STOPS.length; i++) {
    assert.ok(STOPS[i][0] > STOPS[i - 1][0], 'heights ascend');
    assert.ok(lum(STOPS[i][1]) < lum(STOPS[i - 1][1]) - 4, `luminance at ${STOPS[i][0]} m`);
  }
});

test('no ramp colour can be mistaken for sky, land or sea in chromaticity', () => {
  for (const [h, c] of STOPS) for (const [name, bg] of [['sky', SKY], ['land', LAND], ['ocean', OCEAN]] as const) {
    const a = chroma(c), b = chroma(bg);
    const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    assert.ok(d > 0.05, `${h} m vs ${name}: ${d.toFixed(3)}`);
  }
});

test('the legend gradient lists every stop at its height share', () => {
  const css = rampCss(250);
  for (const [h, c] of STOPS) assert.ok(css.includes(`${rgbOf(c)} ${(Math.min(h, 250) / 250 * 100).toFixed(1)}%`), `${h} m in ${css}`);
});
