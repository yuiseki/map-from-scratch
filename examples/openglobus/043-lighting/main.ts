import { dragCamera, zoomCamera, type Camera } from './camera.ts';
import { GlobeRenderer } from './globe.ts';
import { SLIDERS, paramsFrom } from './shading.ts';
import { subsolarPoint, sunDirection } from './sun.ts';
import { PLAY_HOURS_PER_SECOND, advance, formatUtc, minuteOfDay, withMinute } from './timeline.ts';

const DATA = '../../../data/baked/openglobus-043-lighting/';
const pageStart = (window as unknown as { __mfsPageStart?: number }).__mfsPageStart ?? 0;
const bench = new URLSearchParams(location.search).has('bench');

const load = (name: string) => { const img = new Image(); img.src = DATA + name; return img.decode().then(() => img); };
const [day, water, lights] = await Promise.all([load('earth.jpg'), load('water.png'), load('lights.png')]);

const canvas = document.getElementById('globe') as HTMLCanvasElement;
const renderer = new GlobeRenderer(canvas, day, water, lights);

const values: Record<string, number> = Object.fromEntries(SLIDERS.map((s) => [s.id, s.value]));
let atmosphere = true;
let time = Date.now();
const sub = subsolarPoint(new Date(time));
// Open on the evening side: the terminator a third of the way in from the right edge.
let camera: Camera = { lon: ((sub.lon + 240) % 360) - 180, lat: 20, distance: 3 };
let playing = false;
let frames = 0;
let firstFrameMs = 0;
let pending = false;
let last = 0;

const $ = (id: string) => document.getElementById(id)!;
const timeSlider = $('time') as HTMLInputElement;
const dateInput = $('date') as HTMLInputElement;
const timeLabel = $('time-label');
const playButton = $('play') as HTMLButtonElement;

// Sliders, generated from the shared definitions.
const panel = $('sliders');
for (const s of SLIDERS) {
  const row = document.createElement('label');
  row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" data-id="${s.id}"><output>${s.value}</output>`;
  const input = row.querySelector('input')!, out = row.querySelector('output')!;
  input.addEventListener('input', () => { values[s.id] = Number(input.value); out.textContent = input.value; request(); });
  panel.append(row);
}
($('atmosphere') as HTMLInputElement).addEventListener('change', (e) => { atmosphere = (e.target as HTMLInputElement).checked; request(); });

function showTime(): void {
  timeSlider.value = String(minuteOfDay(time));
  dateInput.value = new Date(time).toISOString().slice(0, 10);
  timeLabel.textContent = formatUtc(time);
}
timeSlider.addEventListener('input', () => { time = withMinute(time, Number(timeSlider.value)); showTime(); request(); });
dateInput.addEventListener('change', () => {
  const d = Date.parse(dateInput.value + 'T00:00:00Z');
  if (Number.isFinite(d)) { time = d + minuteOfDay(time) * 60_000; showTime(); request(); }
});
playButton.addEventListener('click', () => {
  playing = !playing;
  playButton.textContent = playing ? '❚❚' : '▶';
  playButton.setAttribute('aria-pressed', String(playing));
  last = 0;
  request();
});
$('now').addEventListener('click', () => { time = Date.now(); showTime(); request(); });

// Drag to rotate, wheel to zoom.
let dragging = false, px = 0, py = 0;
canvas.addEventListener('pointerdown', (e) => { dragging = true; px = e.clientX; py = e.clientY; canvas.setPointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  camera = dragCamera(camera, e.clientX - px, e.clientY - py, canvas.clientHeight);
  px = e.clientX; py = e.clientY;
  request();
});
const stop = () => { dragging = false; };
canvas.addEventListener('pointerup', stop);
canvas.addEventListener('pointercancel', stop);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); camera = zoomCamera(camera, e.deltaY); request(); }, { passive: false });

function resize(): void { renderer.resize(canvas.clientWidth, canvas.clientHeight); request(); }
new ResizeObserver(resize).observe(canvas);

function draw(): void {
  renderer.render({ camera, sun: sunDirection(new Date(time)), params: paramsFrom(values, atmosphere) });
  frames++;
}

function frame(now: number): void {
  pending = false;
  if (playing) {
    time = advance(time, last ? (now - last) / 1000 : 0, PLAY_HOURS_PER_SECOND);
    last = now;
    showTime();
  }
  draw();
  if (!firstFrameMs) firstFrameMs = performance.now() - pageStart;
  if (playing) request();
}

function request(): void {
  if (pending) return;
  pending = true;
  requestAnimationFrame(frame);
}

showTime();
resize();

export interface App {
  renderer: GlobeRenderer;
  values: Record<string, number>;
  frames: () => number;
  firstFrameMs: () => number;
  state: () => { camera: Camera; time: number; atmosphere: boolean; playing: boolean };
  set: (s: { camera?: Camera; time?: number; atmosphere?: boolean }) => void;
  drawNow: () => void;
}
const app: App = {
  renderer, values,
  frames: () => frames,
  firstFrameMs: () => firstFrameMs,
  state: () => ({ camera, time, atmosphere, playing }),
  set: (s) => {
    if (s.camera) camera = s.camera;
    if (s.time !== undefined) { time = s.time; showTime(); }
    if (s.atmosphere !== undefined) atmosphere = s.atmosphere;
  },
  drawNow: draw,
};
if (bench) void import('./bench.ts').then(({ run }) => run(app));
