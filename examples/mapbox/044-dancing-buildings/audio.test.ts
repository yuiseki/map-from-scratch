import test from 'node:test';
import assert from 'node:assert/strict';
import { rhythm, levelsAt, analyse, FFT_SIZE, LOOP_S, LOOP_FRAMES, HOP, SAMPLE_RATE, STEP_S } from './audio.ts';
import { BANDS } from './format.ts';
import { levelOf } from './dance.ts';

test('the analyser gives one bin per band, and the loop is a whole number of analysis hops', () => {
  assert.equal(FFT_SIZE / 2, BANDS);
  assert.ok(Math.abs(HOP / SAMPLE_RATE - 1 / 60) < 0.001, 'one row per frame at 60 Hz, as the original reads the analyser per frame');
  assert.equal(LOOP_FRAMES, (LOOP_S * SAMPLE_RATE) / HOP);
  assert.ok(Number.isInteger(LOOP_FRAMES));
});

test('the same seed gives the same rhythm; another seed another one', () => {
  assert.deepEqual(rhythm(7), rhythm(7));
  assert.notDeepEqual(rhythm(7), rhythm(8));
});

test('every beat has a kick, every hit lies in the loop on a step, in time order', () => {
  for (const seed of [1, 2, 3, 99]) {
    const hits = rhythm(seed);
    for (let beat = 0; beat < LOOP_S / (4 * STEP_S); beat++) {
      assert.ok(hits.some((h) => h.voice === 'kick' && Math.abs(h.t - beat * 4 * STEP_S) < 1e-9), `seed ${seed} beat ${beat}`);
    }
    for (let i = 0; i < hits.length; i++) {
      const h = hits[i];
      assert.ok(h.t >= 0 && h.t < LOOP_S);
      assert.ok(Math.abs(h.t / STEP_S - Math.round(h.t / STEP_S)) < 1e-9);
      if (i) assert.ok(hits[i - 1].t <= h.t);
    }
    // Something above the bass, or the outer rings never move.
    assert.ok(hits.some((h) => h.voice === 'hat') && hits.some((h) => h.voice === 'lead'));
  }
});

test('levelsAt reads the row of the time through levelOf, and wraps at the loop', () => {
  const table = new Uint8Array(LOOP_FRAMES * BANDS);
  for (let k = 0; k < LOOP_FRAMES; k++) for (let b = 0; b < BANDS; b++) table[k * BANDS + b] = (k * 7 + b * 11) % 256;
  const out = new Float32Array(BANDS);
  const hop = HOP / SAMPLE_RATE;
  levelsAt(table, 3.5 * hop, out);
  assert.equal(out[0], Math.fround(levelOf(21)));
  assert.equal(out[5], Math.fround(levelOf(21 + 55)));
  levelsAt(table, LOOP_S + 2.2 * hop, out);
  assert.equal(out[0], Math.fround(levelOf(14)));
});

const sine = (hz: number, amp: number, seconds: number, from = 0) => {
  const x = new Float32Array(Math.round(seconds * SAMPLE_RATE));
  for (let i = Math.round(from * SAMPLE_RATE); i < x.length; i++) x[i] = amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  return x;
};

test('analyse puts a tone in the bin of its frequency, as an AnalyserNode with fftSize 32 does', () => {
  for (const bin of [1, 3, 7, 12]) {
    const hz = (bin * SAMPLE_RATE) / FFT_SIZE;
    const t = analyse(sine(hz, 0.5, 1), 20);
    const row = t.subarray(19 * BANDS, 20 * BANDS);
    const peak = row.indexOf(Math.max(...row));
    assert.equal(peak, bin, `tone at bin ${bin}: ${[...row]}`);
    assert.ok(row[peak] > 150, `level ${row[peak]}`);
  }
});

test('analyse maps silence to 0 and keeps bytes within the decibel range', () => {
  assert.ok(analyse(new Float32Array(SAMPLE_RATE), 30).every((v) => v === 0));
  const loud = analyse(sine(4500, 1, 1), 30);
  assert.ok(Math.max(...loud) <= 255);
});

test('analyse smooths over hops: a tone that stops fades over several hops, not at once', () => {
  const hz = (3 * SAMPLE_RATE) / FFT_SIZE;
  const x = sine(hz, 0.5, 2);
  x.fill(0, SAMPLE_RATE);                       // silence from 1 s
  const t = analyse(x, Math.floor((2 * SAMPLE_RATE) / HOP));
  const at = (k: number) => t[k * BANDS + 3];
  const k1 = Math.ceil(SAMPLE_RATE / HOP) + 1;  // first hop wholly after the stop
  assert.ok(at(k1) > 0 && at(k1) < at(k1 - 3), `fading ${at(k1 - 3)} -> ${at(k1)}`);
  assert.ok(at(k1 + 2) < at(k1));
});
