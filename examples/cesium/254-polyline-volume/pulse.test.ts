import assert from 'node:assert/strict';
import test from 'node:test';
import { pulseHead, pulseGlow, PULSE_GAP_KM, PULSE_SIGMA_KM, TIME_SCALE } from './pulse.ts';
import { tubeShaders } from './shaders.ts';

test('the pulse travels at the line speed times the time scale (1 s = 6 min)', () => {
  assert.equal(TIME_SCALE, 360);
  // 285 km/h for 1 s of page time is 285 * 360 / 3600 = 28.5 km
  assert.ok(Math.abs(pulseHead(1, 285, 515) - pulseHead(0, 285, 515) - 28.5) < 1e-9);
});

test('speeds are proportional: Tohoku at 320 km/h runs 320/130 as far as Yamagata at 130 km/h', () => {
  const a = pulseHead(2, 320, 675) - pulseHead(0, 320, 675), b = pulseHead(2, 130, 146) - pulseHead(0, 130, 146);
  assert.ok(Math.abs(a / b - 320 / 130) < 1e-9);
});

test('the pulse enters before the start, leaves past the end, and starts again', () => {
  assert.equal(pulseHead(0, 300, 100), -PULSE_GAP_KM);
  const period = ((100 + 2 * PULSE_GAP_KM) / (300 * TIME_SCALE / 3600));
  assert.ok(Math.abs(pulseHead(period * 0.999, 300, 100) - (100 + PULSE_GAP_KM)) < 1);
  assert.ok(Math.abs(pulseHead(period * 1.001, 300, 100) + PULSE_GAP_KM) < 1);
});

test('the glow is a Gaussian of PULSE_SIGMA_KM about the head, and the shader uses the same constant', () => {
  assert.equal(pulseGlow(50, 50), 1);
  assert.ok(Math.abs(pulseGlow(50 + PULSE_SIGMA_KM, 50) - Math.exp(-0.5)) < 1e-12);
  assert.ok(pulseGlow(50 + 5 * PULSE_SIGMA_KM, 50) < 1e-5);
  assert.ok(tubeShaders().fs.includes(PULSE_SIGMA_KM.toFixed(3)), 'shader built from the exported sigma');
});
