// The sound: the microphone, as in the original, or a built-in rhythm made
// with WebAudio oscillators and seeded noise (no audio files).
//
// The rhythm is rendered once with an OfflineAudioContext (two loops, so the
// smoothing has its history) and analysed into a table of LOOP_FRAMES x 16
// bytes by analyse(), which does what the Web Audio spec says an
// AnalyserNode with the original's settings does at each read. The page
// reads the row of the current time, so the silent dance is the same on
// every run (the bench relies on it) and needs no user gesture. Reading a
// real AnalyserNode offline was tried first: OfflineAudioContext.suspend()
// cost about 100 ms per stop in headless Chromium (10 stops 1.06 s, 50 stops
// 4.7 s), 50 s for the 500 reads. The microphone and the rhythm played aloud
// go through a real AnalyserNode, read every frame.
import { BANDS } from './format.ts';
import { levelOf } from './dance.ts';

export const FFT_SIZE = BANDS * 2;
export const SAMPLE_RATE = 48000;
export const HOP = 768;                       // 16 ms, about one frame at 60 Hz
export const BPM = 120;
export const STEP_S = 60 / BPM / 4;           // sixteenth notes
export const STEPS = 32;                      // two bars
export const LOOP_S = STEPS * STEP_S;         // 4 s
export const LOOP_FRAMES = (LOOP_S * SAMPLE_RATE) / HOP;
export const SEED = 44;

export function configure(a: AnalyserNode): AnalyserNode {
  // The original's settings.
  a.fftSize = FFT_SIZE;
  a.minDecibels = -90;
  a.maxDecibels = -10;
  a.smoothingTimeConstant = 0.85;
  return a;
}

export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Voice = 'kick' | 'snare' | 'hat' | 'lead';
export interface Hit { t: number; voice: Voice; freq: number; gain: number }

// Pentatonic notes for the lead (A minor), Hz.
const LEAD = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99];

export function rhythm(seed: number): Hit[] {
  const r = rng(seed), hits: Hit[] = [];
  for (let i = 0; i < STEPS; i++) {
    const t = i * STEP_S;
    if (i % 4 === 0 || r() < 0.12) hits.push({ t, voice: 'kick', freq: 55, gain: i % 4 === 0 ? 1 : 0.7 });
    if (i % 8 === 4 || r() < 0.06) hits.push({ t, voice: 'snare', freq: 180, gain: 0.8 });
    if (i % 2 === 1 || r() < 0.4) hits.push({ t, voice: 'hat', freq: 8000, gain: 0.25 + 0.3 * r() });
    if (r() < 0.45) hits.push({ t, voice: 'lead', freq: LEAD[Math.floor(r() * LEAD.length)] * (r() < 0.3 ? 2 : 1), gain: 0.18 });
  }
  return hits;
}

function noise(ctx: BaseAudioContext, seed: number): AudioBuffer {
  const b = ctx.createBuffer(1, Math.round(ctx.sampleRate * 0.3), ctx.sampleRate), d = b.getChannelData(0), r = rng(seed ^ 0x9e3779b9);
  for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
  return b;
}

function schedule(ctx: BaseAudioContext, out: AudioNode, hits: Hit[], at: number, buf: AudioBuffer): void {
  const env = (g: GainNode, t: number, peak: number, decay: number) => {
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay);
  };
  for (const h of hits) {
    const t = at + h.t, g = ctx.createGain();
    g.connect(out);
    if (h.voice === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(h.freq, t + 0.12);
      env(g, t, h.gain, 0.35);
      o.connect(g); o.start(t); o.stop(t + 0.4);
    } else if (h.voice === 'lead') {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(h.freq, t);
      env(g, t, h.gain, 0.22);
      o.connect(g); o.start(t); o.stop(t + 0.25);
    } else {
      const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter();
      s.buffer = buf;
      fl.type = h.voice === 'hat' ? 'highpass' : 'bandpass';
      fl.frequency.value = h.voice === 'hat' ? 7000 : 2500;
      env(g, t, h.gain, h.voice === 'hat' ? 0.06 : 0.18);
      s.connect(fl); fl.connect(g); s.start(t); s.stop(t + 0.25);
      if (h.voice === 'snare') {
        const o = ctx.createOscillator(), g2 = ctx.createGain();
        o.type = 'triangle';
        o.frequency.value = h.freq;
        env(g2, t, 0.5, 0.1);
        o.connect(g2); g2.connect(out); o.start(t); o.stop(t + 0.12);
      }
    }
  }
}

// The byte frequency data of an AnalyserNode (fftSize FFT_SIZE, the
// original's decibel range and smoothing) read every HOP samples: row k is
// what getByteFrequencyData returns at time k * HOP / SAMPLE_RATE. Web Audio
// spec, "FFT windowing and smoothing over time": Blackman window, |X[k]| / N,
// exponential smoothing, 20 log10, scaled to the decibel range, clamped.
export function analyse(x: Float32Array, rows: number): Uint8Array {
  const N = FFT_SIZE, a = 0.16, w = new Float64Array(N), smooth = new Float64Array(BANDS);
  for (let n = 0; n < N; n++) w[n] = (1 - a) / 2 - 0.5 * Math.cos((2 * Math.PI * n) / N) + (a / 2) * Math.cos((4 * Math.PI * n) / N);
  const out = new Uint8Array(rows * BANDS), frame = new Float64Array(N);
  const tau = 0.85, minDb = -90, maxDb = -10;
  for (let k = 0; k < rows; k++) {
    const end = k * HOP;
    for (let n = 0; n < N; n++) {
      const i = end - N + n;
      frame[n] = i >= 0 && i < x.length ? x[i] * w[n] : 0;
    }
    for (let b = 0; b < BANDS; b++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const ph = (-2 * Math.PI * b * n) / N;
        re += frame[n] * Math.cos(ph);
        im += frame[n] * Math.sin(ph);
      }
      smooth[b] = tau * smooth[b] + (1 - tau) * (Math.hypot(re, im) / N);
      const db = 20 * Math.log10(smooth[b]);
      out[k * BANDS + b] = Math.max(0, Math.min(255, Math.floor((255 / (maxDb - minDb)) * (db - minDb))));
    }
  }
  return out;
}

export interface Analysed { table: Uint8Array; loop: AudioBuffer }

export async function analyseRhythm(seed = SEED): Promise<Analysed> {
  const ctx = new OfflineAudioContext(1, LOOP_S * 2 * SAMPLE_RATE, SAMPLE_RATE);
  const hits = rhythm(seed), buf = noise(ctx, seed);
  schedule(ctx, ctx.destination, hits, 0, buf);
  schedule(ctx, ctx.destination, hits, LOOP_S, buf);
  const samples = (await ctx.startRendering()).getChannelData(0);
  // Keep the second loop: its first rows carry the smoothing of the first.
  const table = analyse(samples, 2 * LOOP_FRAMES).slice(LOOP_FRAMES * BANDS);
  const loop = new AudioBuffer({ length: LOOP_S * SAMPLE_RATE, sampleRate: SAMPLE_RATE });
  loop.copyToChannel(samples.subarray(LOOP_S * SAMPLE_RATE), 0);
  return { table, loop };
}

// The levels (0..1, gated: dance.ts levelOf) at time t (s) into the loop.
export function levelsAt(table: Uint8Array, t: number, out: Float32Array): Float32Array {
  const k = Math.floor((t * SAMPLE_RATE) / HOP) % LOOP_FRAMES;
  for (let b = 0; b < BANDS; b++) out[b] = levelOf(table[k * BANDS + b]);
  return out;
}
