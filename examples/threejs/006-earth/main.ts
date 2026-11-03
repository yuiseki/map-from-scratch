import { EarthRenderer, rotateCamera, zoomDistance } from './globe.ts';

const canvas = document.getElementById('earth') as HTMLCanvasElement;
const image = new Image();
image.src = './earth.jpg';
await image.decode();
const renderer = new EarthRenderer(canvas, image);
let yaw = 0.15;
let pitch = -0.12;
let distance = 3.45;
let dragging = false;
let px = 0;
let py = 0;
const queryBench = new URLSearchParams(location.search).has('bench');
const pageStart = (window as unknown as { __mfsPageStart?: number }).__mfsPageStart ?? performance.now();
let firstFrameMs = 0;

function resize(): void {
  renderer.resize(canvas.clientWidth, canvas.clientHeight);
}
window.addEventListener('resize', resize);
resize();

canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  px = event.clientX;
  py = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  [yaw, pitch] = rotateCamera(yaw, pitch, event.clientX - px, event.clientY - py);
  px = event.clientX;
  py = event.clientY;
});
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  distance = zoomDistance(distance, event.deltaY);
}, { passive: false });

let lastTime = 0;
function frame(now: number): void {
  const dt = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
  lastTime = now;
  if (!dragging && !queryBench) yaw += dt * 0.11;
  renderer.render(yaw, pitch, distance);
  if (!firstFrameMs) firstFrameMs = performance.now() - pageStart;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

(window as unknown as { __mfsEarth: EarthRenderer; __mfsFirstFrame: () => number }).__mfsEarth = renderer;
(window as unknown as { __mfsFirstFrame: () => number }).__mfsFirstFrame = () => firstFrameMs;
if (queryBench) {
  void import('./bench.ts').then(({ run }) => run(renderer, () => firstFrameMs));
}
