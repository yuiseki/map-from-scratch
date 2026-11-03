import test from 'node:test';
import assert from 'node:assert/strict';
import { GAIN, FLOOR, levelOf, lightOf, VS, FS } from './dance.ts';
import { BANDS } from './format.ts';

const flat = (v: number) => new Float32Array(BANDS).fill(v);

test('the vertex shader raises only the top vertices, by height * (1 + GAIN * level of the band)', () => {
  assert.ok(GAIN > 0);
  assert.match(VS, new RegExp(`uniform float uLevels\\[${BANDS}\\]`));
  // The bench predicts the danced roof with the same GAIN it reads here.
  assert.ok(VS.includes(`aTop * aHeight * (1.0 + ${GAIN.toFixed(3)} * level)`), VS);
  assert.ok(VS.includes(`uLevels[aBand]`));
});

test('the fragment shader takes its light colour from the uniform lightOf fills', () => {
  assert.match(FS, /uniform vec4 uLight;/);
});

test('silence: no coloured light (intensity 0), whatever the hue', () => {
  for (const t of [0, 5000, 20000]) assert.equal(lightOf(t, flat(0))[3], 0);
});

test('the hue turns with time, 10 degrees per second as in the original (now / 100)', () => {
  const loud = flat(0.5);
  const red = lightOf(0, loud), green = lightOf(12000, loud), blue = lightOf(24000, loud);
  assert.ok(red[0] > red[1] && red[0] > red[2], `hue 0 is red ${[...red]}`);
  assert.ok(green[1] > green[0] && green[1] > green[2], `hue 120 is green ${[...green]}`);
  assert.ok(blue[2] > blue[0] && blue[2] > blue[1], `hue 240 is blue ${[...blue]}`);
  assert.deepEqual([...lightOf(36000, loud)].map((v) => v.toFixed(5)), [...red].map((v) => v.toFixed(5)), 'hue wraps at 360');
});

test('louder is more saturated and brighter, intensity capped at 1', () => {
  const quiet = lightOf(0, flat(0.02)), loud = lightOf(0, flat(0.6));
  const sat = (c: Float32Array) => Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]);
  assert.ok(sat(loud) > sat(quiet));
  assert.ok(loud[3] > quiet[3] && quiet[3] > 0);
  assert.equal(lightOf(0, flat(1))[3], 1);
});

test('levelOf gates the analyser byte: 0 up to the floor, 1 at 255, rising in between', () => {
  assert.equal(levelOf(0), 0);
  assert.equal(levelOf(Math.floor(FLOOR * 255)), 0);
  assert.equal(levelOf(255), 1);
  assert.ok(levelOf(200) > levelOf(150) && levelOf(150) > 0);
});
