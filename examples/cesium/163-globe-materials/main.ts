import { createGlobeRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const renderer = createGlobeRenderer(canvas);
(window as unknown as { __mfsRenderer: typeof renderer }).__mfsRenderer = renderer;

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});

// Interactive Orbit Controls
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.5;
let pitch = 0.3;
let dist = 160.0;

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

// Setup UI control checkboxes
const contourCheck = document.getElementById('chk-contours') as HTMLInputElement | null;
const elevationCheck = document.getElementById('chk-elevation') as HTMLInputElement | null;
const radarCheck = document.getElementById('chk-radar') as HTMLInputElement | null;
const rotateCheck = document.getElementById('chk-rotate') as HTMLInputElement | null;

contourCheck?.addEventListener('change', (e) => {
  renderer.toggleContours((e.target as HTMLInputElement).checked);
});
elevationCheck?.addEventListener('change', (e) => {
  renderer.toggleElevation((e.target as HTMLInputElement).checked);
});
radarCheck?.addEventListener('change', (e) => {
  renderer.toggleRadar((e.target as HTMLInputElement).checked);
});
rotateCheck?.addEventListener('change', (e) => {
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
