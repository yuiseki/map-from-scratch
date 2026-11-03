// Bench for mapbox-044-dancing-buildings. Loaded by main.ts only with
// ?bench, after the first frame. It stops the page's own loop and draws
// fixed, reproducible frames: the levels come from the rhythm table (seed
// SEED), the time is the table row's time.
import { emit, glRenderer, benchFrames } from '../../../harness/page/bench.ts';
import { makeView, project, groundAt, type Cam, type View } from './camera.ts';
import { GAIN, SKY, GROUND } from './dance.ts';
import { analyseRhythm, levelsAt, LOOP_FRAMES, HOP, SAMPLE_RATE } from './audio.ts';
import { BANDS, UNIT_M } from './format.ts';
import type { Renderer } from './render.ts';

interface Dance {
  gl: WebGL2RenderingContext; renderer: Renderer; firstFrameMs: number;
  rhythmReady: Promise<{ ms: number; r: { table: Uint8Array } }>;
  cam: Cam; view(c?: Cam): View; draw(c: Cam, levels: Float32Array, nowMs: number): void; stop(): void;
}
interface Truth { buildings: number; tallest: { name: string; height: number; cx: number; cy: number; band: number; ring: number[] } }

const D = (window as unknown as { __dance: Dance }).__dance;
const { gl } = D;
const canvas = gl.canvas as HTMLCanvasElement;
D.stop();
gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'webglcontextlost' }));
emit({ info: { gpu: glRenderer(gl), triangles: D.renderer.triangles, width: canvas.width, height: canvas.height } });
emit({ metric: 'first_frame_ms', value: D.firstFrameMs });
const ready = await D.rhythmReady;
emit({ metric: 'rhythm_ms', value: ready.ms });
const table = ready.r.table;
const truth: Truth = await (await fetch('../../../data/baked/mapbox-044-dancing-buildings/truth.json')).json();
const W = canvas.width, H = canvas.height;
const START: Cam = { cx: 0, cy: -150, bearing: -20, pitch: 66, distance: 2400 }; // main.ts START
const rowTime = (k: number) => (k * HOP) / SAMPLE_RATE;
const zero = new Float32Array(BANDS);

// --- the readback helpers: what reached the drawing buffer, y down
function pixels(x: number, y: number, w: number, h: number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(x, H - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return px;
}
const sky = SKY.map((v) => Math.round(v * 255)), ground = GROUND.map((v) => Math.round(v * 255));
const near = (px: Uint8Array, i: number, c: number[], tol: number) =>
  Math.abs(px[i] - c[0]) <= tol && Math.abs(px[i + 1] - c[1]) <= tol && Math.abs(px[i + 2] - c[2]) <= tol;

// The first row from the top in column x that is not sky.
function topOf(x: number): number {
  const col = pixels(x, 0, 1, H);
  for (let y = 0; y < H; y++) if (!near(col, (H - 1 - y) * 4, sky, 6)) return y;
  return H;
}

// --- 1. the camera path: a full turn while the rhythm plays
const uploads = { bytes: 0 };
for (const name of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D'] as const) {
  const f = (gl as unknown as Record<string, (...a: unknown[]) => unknown>)[name].bind(gl);
  (gl as unknown as Record<string, unknown>)[name] = (...a: unknown[]) => {
    const d = a.find((v) => ArrayBuffer.isView(v)) as ArrayBufferView | undefined;
    uploads.bytes += d ? d.byteLength : 0;
    return f(...a);
  };
}
const lv = new Float32Array(BANDS);
const STEPS = 240;
await benchFrames(gl, STEPS, (i) => {
  levelsAt(table, rowTime(i), lv);
  D.draw({ ...START, bearing: START.bearing + i * 1.5 }, lv, rowTime(i) * 1000);
});
emit({ metric: 'frame_upload_bytes', value: uploads.bytes / (STEPS + 10) });
// The whole area from far away: every building in view.
const WHOLE: Cam = { cx: 0, cy: -150, bearing: 30, pitch: 40, distance: 5500 };
await benchFrames(gl, 120, (i) => {
  levelsAt(table, rowTime(i), lv);
  D.draw(WHOLE, lv, rowTime(i) * 1000);
}, { prefix: 'whole_' });

// --- 2. checks
const T = truth.tallest;
// A low camera looking at the tallest building (GranTokyo South Tower in the
// 2025 data) from outside the city: the eye is below its roof, so nothing
// behind it can show above the roof line, and the roof line is the near edge.
const LOW: Cam = { cx: T.cx, cy: T.cy, bearing: 0, pitch: 86, distance: 1100 };
function roofRange(c: Cam, h: number): [number, number, number] {
  const v = makeView(c, W, H);
  let lo = Infinity, hi = -Infinity, sx = 0, n = 0;
  for (let i = 0; i < T.ring.length; i += 2) {
    const p = project(v, [T.ring[i], T.ring[i + 1], h])!;
    lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); sx += p[0]; n++;
  }
  return [lo, hi, Math.round(sx / n)];
}
// Heights as the page draws them: 0.1 m steps.
const hBaked = Math.round(T.height / UNIT_M) * UNIT_M;
{
  D.draw(LOW, zero, 0);
  const [lo, hi, x] = roofRange(LOW, hBaked);
  const top = topOf(x);
  const [lo90, hi90] = roofRange(LOW, hBaked * 0.9);
  const pass = top >= Math.floor(lo) - 2 && top <= Math.ceil(hi) + 2 && (top < lo90 - 2 || top > hi90 + 2);
  emit({ check: 'real-height-at-zero', pass, detail: JSON.stringify({ building: T.name, height: hBaked, column: x, top, expected: [lo, hi], at90pct: [lo90, hi90] }) });
}
{
  const L = 0.4, one = new Float32Array(BANDS);
  one[T.band] = L;
  D.draw(LOW, zero, 0);
  const [, , x] = roofRange(LOW, hBaked);
  const top0 = topOf(x);
  D.draw(LOW, one, 0);
  const top1 = topOf(x);
  const [lo, hi] = roofRange(LOW, hBaked * (1 + GAIN * L));
  const pass = top1 < top0 - 20 && top1 >= Math.floor(lo) - 2 && top1 <= Math.ceil(hi) + 2;
  emit({ check: 'roof-rises-with-level', pass, detail: JSON.stringify({ band: T.band, level: L, top0, top1, expected: [lo, hi] }) });
}
{
  // Two frames of the dance 3 s apart: the hue has turned 30 degrees and the levels differ.
  const a = 40, b = a + Math.round(3 / rowTime(1));
  const patch = (k: number) => {
    levelsAt(table, rowTime(k), lv);
    D.draw(START, lv, rowTime(k) * 1000);
    return pixels(W / 2 - 64, H / 2 - 64, 128, 128);
  };
  const p = patch(a), q = patch(b);
  let d = 0;
  for (let i = 0; i < p.length; i += 4) d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]);
  const mean = d / (p.length / 4) / 3;
  emit({ check: 'colours-change', pass: mean > 6, detail: JSON.stringify({ rows: [a, b], meanAbsDiff: Math.round(mean * 10) / 10 }) });
}
{
  D.draw(START, zero, 0);
  const top = pixels(0, 0, W, Math.round(H * 0.04)), bottom = pixels(0, Math.round(H / 2), W, Math.round(H / 2));
  let s = 0, g = 0;
  for (let i = 0; i < top.length; i += 4) if (near(top, i, sky, 3)) s++;
  for (let i = 0; i < bottom.length; i += 4) if (near(bottom, i, ground, 3)) g++;
  const sf = s / (top.length / 4), gf = g / (bottom.length / 4);
  emit({ check: 'ground-and-sky', pass: sf > 0.5 && gf > 0.03, detail: JSON.stringify({ skyTop4pct: Math.round(sf * 1000) / 1000, groundBottomHalf: Math.round(gf * 1000) / 1000 }) });
}
{
  // The fallback is the same on every run and moves every band.
  const again = (await analyseRhythm()).table;
  const same = again.length === table.length && again.every((v, i) => v === table[i]);
  const moved: number[] = [];
  for (let band = 0; band < BANDS; band++) {
    let m = 0;
    for (let k = 0; k < LOOP_FRAMES; k++) m = Math.max(m, levelsAt(table, rowTime(k), lv)[band]);
    moved.push(Math.round(m * 100) / 100);
  }
  emit({ check: 'rhythm-reproducible', pass: same && moved.every((m) => m > 0.1), detail: JSON.stringify({ same, maxLevelPerBand: moved }) });
}
{
  // A synthetic drag: the ground under the pointer follows it.
  D.cam = { ...START };
  const r = canvas.getBoundingClientRect(), k = W / r.width;
  const from = [r.left + r.width * 0.5, r.top + r.height * 0.7], to = [from[0] + 100, from[1] + 60];
  const g = groundAt(D.view(), (from[0] - r.left) * k, (from[1] - r.top) * k)!;
  const ev = (type: string, x: number, y: number) =>
    canvas.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, button: 0, pointerId: 1, bubbles: true }));
  ev('pointerdown', from[0], from[1]);
  for (let s = 1; s <= 4; s++) ev('pointermove', from[0] + (to[0] - from[0]) * s / 4, from[1] + (to[1] - from[1]) * s / 4);
  ev('pointerup', to[0], to[1]);
  const p = project(D.view(), [g[0], g[1], 0])!;
  const ex = (to[0] - r.left) * k, ey = (to[1] - r.top) * k;
  emit({ check: 'drag-pans', pass: Math.hypot(p[0] - ex, p[1] - ey) < 2, detail: JSON.stringify({ now: p.map(Math.round), expected: [ex, ey] }) });
}
emit({ done: true });
