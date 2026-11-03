import { createBloomRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = createBloomRenderer(canvas);
(window as unknown as { __mfsRenderer: typeof renderer }).__mfsRenderer = renderer;

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});

// Interactive Orbit Controls
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.55;
let pitch = 0.28;
let dist = 110.0;

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
  renderer.toggleAutoRotate(false);
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  yaw -= dx * 0.008;
  pitch += dy * 0.008;
  renderer.setCameraAngles(yaw, pitch);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist += e.deltaY * 0.1;
  renderer.setCameraDistance(dist);
}, { passive: false });

const chkBloom = document.getElementById('chk-bloom') as HTMLInputElement | null;
const rangeIntensity = document.getElementById('range-intensity') as HTMLInputElement | null;
const labelIntensity = document.getElementById('label-intensity') as HTMLSpanElement | null;
const chkRotate = document.getElementById('chk-rotate') as HTMLInputElement | null;

chkBloom?.addEventListener('change', (e) => {
  renderer.toggleBloom((e.target as HTMLInputElement).checked);
});

rangeIntensity?.addEventListener('input', (e) => {
  const val = parseFloat((e.target as HTMLInputElement).value);
  renderer.setBloomIntensity(val);
  if (labelIntensity) labelIntensity.textContent = `${val.toFixed(1)}x`;
});

chkRotate?.addEventListener('change', (e) => {
  renderer.toggleAutoRotate((e.target as HTMLInputElement).checked);
});

let lastTime = performance.now();
function loop(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  renderer.render(dt);
  requestAnimationFrame(loop);
}

const params = new URLSearchParams(window.location.search);
if (params.has('bench')) {
  import('./bench.ts');
} else {
  requestAnimationFrame(loop);
}
