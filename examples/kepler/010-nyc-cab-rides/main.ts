import { generateNycCabTrips, buildTripsBuffer, MANHATTAN_CENTER } from './trips.ts';
import { CabTripsRenderer } from './render.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const trips = generateNycCabTrips(160);
const mesh = buildTripsBuffer(trips, MANHATTAN_CENTER);
const renderer = new CabTripsRenderer(canvas, mesh);

let pitch = 48;
let bearing = -24;
let distance = 6800;
let currentTime = 180;

function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  renderer.render(pitch, bearing, distance, currentTime);
}

window.addEventListener('resize', resize);
resize();

// Playback animation loop
let lastT = performance.now();
function animate(now: number): void {
  const dt = (now - lastT) * 0.001;
  lastT = now;

  currentTime = (currentTime + dt * 25) % 1200; // 25x speed
  renderer.render(pitch, bearing, distance, currentTime);
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);

// Mouse drag to rotate / pitch, wheel to zoom
let isDragging = false;
let startX = 0;
let startY = 0;

canvas.addEventListener('mousedown', (e) => {
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - startX;
  const dy = e.clientY - startY;
  startX = e.clientX;
  startY = e.clientY;

  bearing += dx * 0.35;
  pitch = Math.max(10, Math.min(85, pitch + dy * 0.35));
  renderer.render(pitch, bearing, distance, currentTime);
});

window.addEventListener('mouseup', () => {
  isDragging = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  distance = Math.max(1500, Math.min(18000, distance + e.deltaY * 5));
  renderer.render(pitch, bearing, distance, currentTime);
}, { passive: false });

(window as unknown as { __mfsRenderer: CabTripsRenderer }).__mfsRenderer = renderer;

if (location.search.includes('bench')) {
  import('./bench.ts');
}
