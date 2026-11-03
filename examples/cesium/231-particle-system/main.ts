import { createParticleSystem } from './particle.ts';
import { createRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

const sys = createParticleSystem({
  fireCount: 400,
  smokeCount: 400,
  emberCount: 150,
  emitterPos: [0, 0, 0],
});

const renderer = createRenderer(canvas, sys);

window.addEventListener('resize', () => {
  renderer.resize(window.innerWidth, window.innerHeight);
});

// Interactive Orbit Controls
let isDragging = false;
let lastX = 0;
let lastY = 0;
let yaw = 0.6;
let pitch = 0.35;
let dist = 22.0;

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
  yaw -= dx * 0.008;
  pitch += dy * 0.008;
  renderer.setCameraAngles(yaw, pitch);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  dist += e.deltaY * 0.02;
  renderer.setCameraDistance(dist);
}, { passive: false });

let lastTime = performance.now();
function loop(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  renderer.render(dt);
  requestAnimationFrame(loop);
}

(window as unknown as { __mfsRenderer: typeof renderer }).__mfsRenderer = renderer;

// Check bench mode
const params = new URLSearchParams(window.location.search);
if (params.has('bench')) {
  import('./bench.ts');
} else {
  requestAnimationFrame(loop);
}
