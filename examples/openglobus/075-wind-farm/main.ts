import { decodeTerrain, heightAt } from './terrain.ts';
import { RotorState, hash01, rotorOmega } from './turbine.ts';
import { orbitDrag, zoomDistance, orbitCamera, MAX_PITCH, type OrbitView } from './camera.ts';
import { openingView } from './opening.ts';
import { WindFarmRenderer, type TurbineInstance } from './render.ts';

const pageStart = (window as unknown as { __mfsPageStart?: number }).__mfsPageStart ?? 0;
const DATA = '../../../data/baked/openglobus-075-wind-farm';
const canvas = document.getElementById('farm') as HTMLCanvasElement;
const dirInput = document.getElementById('dir') as HTMLInputElement;
const speedInput = document.getElementById('speed') as HTMLInputElement;
const readout = document.getElementById('readout')!;

const [terrainBuf, farm] = await Promise.all([
  fetch(`${DATA}/terrain.bin`).then((r) => r.arrayBuffer()),
  fetch(`${DATA}/turbines.json`).then((r) => r.json() as Promise<{ turbines: [number, number, number, number, number, number, string][] }>),
]);
const terrain = decodeTerrain(terrainBuf);
// The tower base stands on the drawn surface at the turbine's point.
const turbines: TurbineInstance[] = farm.turbines.map(([id, x, y, , hub, diameter]) => ({ id, x, y, z: heightAt(terrain, x, y), hub, diameter }));
const radii = turbines.map((t) => t.diameter / 2);
// per-turbine phase and a +-8 % spread of speed (controllers do not run in step)
const rotors = new RotorState(radii, turbines.map((t) => hash01(t.id) * 2 * Math.PI), turbines.map((t) => 0.92 + 0.16 * hash01(t.id * 7 + 3)));
const renderer = new WindFarmRenderer(canvas, terrain, turbines);

// Opening view: a low oblique shot down the rows of Wind Farm Tsugaru
// towards Mt Iwaki, framed on one turbine (opening.ts).
let view: OrbitView = openingView(turbines, (x, y) => heightAt(terrain, x, y));

// Keep the eye above the ground: tilt down until it clears it by 40 m.
function clampToGround(v: OrbitView): OrbitView {
  let out = v;
  for (let i = 0; i < 80; i++) {
    const eye = orbitCamera(out, 1).eye;
    if (eye[2] > heightAt(terrain, eye[0], eye[1]) + 40 || out.pitch >= MAX_PITCH) break;
    out = { ...out, pitch: Math.min(MAX_PITCH, out.pitch + 0.5) };
  }
  return out;
}
view = clampToGround(view);

const compass = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];
let firstFrame = 0;
let last = performance.now();
let raf = 0;

function frame(now: number): void {
  raf = 0;
  const wind = +speedInput.value;
  rotors.advance(Math.min(0.1, (now - last) / 1000), wind);
  last = now;
  draw();
  if (rotorOmega(wind, 50) > 0) schedule();
}
function draw(): void {
  renderer.render(view, +dirInput.value, rotors.gpu);
  if (!firstFrame) firstFrame = performance.now() - pageStart;
}
function schedule(): void { if (!raf) raf = requestAnimationFrame(frame); }
function updateReadout(): void {
  const dir = +dirInput.value, wind = +speedInput.value;
  const rpm = (rotorOmega(wind, 98.3 / 2 + 3) * 60) / (2 * Math.PI);
  readout.textContent = `風向 ${dir}° (${compass[Math.round(dir / 22.5) % 16]}の風)\n風速 ${wind} m/s · 3.2 MW 機 ${rpm.toFixed(1)} rpm\n風車 ${turbines.length} 基`;
}
function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  renderer.resize(Math.round(canvas.clientWidth * dpr), Math.round(canvas.clientHeight * dpr));
  draw();
}
new ResizeObserver(resize).observe(canvas);
resize();
updateReadout();
for (const el of [dirInput, speedInput]) el.addEventListener('input', () => { updateReadout(); draw(); schedule(); });

let drag: { x: number; y: number } | null = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  view = clampToGround(orbitDrag(view, e.clientX - drag.x, e.clientY - drag.y));
  drag = { x: e.clientX, y: e.clientY };
  draw();
});
const end = () => { drag = null; };
canvas.addEventListener('pointerup', end);
canvas.addEventListener('pointercancel', end);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  view = clampToGround({ ...view, distance: zoomDistance(view.distance, e.deltaY) });
  draw();
}, { passive: false });

if (new URLSearchParams(location.search).has('bench')) {
  // the bench drives the frames itself
  void import('./bench.ts').then(({ run }) => run({ renderer, terrain, rotors, view: () => view, firstFrame: () => firstFrame }));
} else {
  schedule();
}
