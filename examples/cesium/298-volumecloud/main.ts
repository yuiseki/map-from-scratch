import { createVolumeCloudRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = createVolumeCloudRenderer(canvas);
(window as unknown as { __mfsRenderer: typeof renderer }).__mfsRenderer = renderer;

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});

// Interactive Orbit Controls
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.5;
let pitch = 0.25;
let dist = 46.0;

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  lastX = e.clientX;
  lastY = e.clientY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - lastX;
  const dy = e.clientY - lastY;
  lastX = e.clientX;
  lastY = e.clientY;
  yaw -= dx * 0.007;
  pitch += dy * 0.007;
  renderer.setCameraAngles(yaw, pitch);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist += e.deltaY * 0.05;
  renderer.setCameraDistance(dist);
}, { passive: false });

const chkRotate = document.getElementById('chk-rotate') as HTMLInputElement | null;
const rangeCoverage = document.getElementById('range-coverage') as HTMLInputElement | null;
const rangeSun = document.getElementById('range-sun') as HTMLInputElement | null;

chkRotate?.addEventListener('change', (e) => {
  renderer.toggleAutoRotate((e.target as HTMLInputElement).checked);
});

rangeCoverage?.addEventListener('input', (e) => {
  const coverage = parseFloat((e.target as HTMLInputElement).value) / 100;
  renderer.setCloudCoverage(coverage);
});

rangeSun?.addEventListener('input', (e) => {
  const el = (parseFloat((e.target as HTMLInputElement).value) / 180) * Math.PI;
  renderer.setSunAngles(1.0, el);
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
