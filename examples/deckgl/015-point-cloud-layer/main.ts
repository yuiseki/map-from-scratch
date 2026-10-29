import { PointCloud } from './renderer.ts';

const started = performance.now();
const response = await fetch('../../../data/baked/deckgl-015-point-cloud-layer/points.bin');
if (!response.ok) throw new Error(`point cloud: HTTP ${response.status}`);
const map = new PointCloud(document.getElementById('map') as HTMLCanvasElement, await response.arrayBuffer());
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
document.getElementById('status')!.textContent = `${map.count.toLocaleString('ja-JP')} 点`;
let drag: { x: number; y: number; pan: boolean } | null = null;
const canvas = map.canvas;
canvas.addEventListener('contextmenu', (event) => event.preventDefault());
canvas.addEventListener('pointerdown', (event) => {
  map.autoRotate = false;
  drag = { x: event.clientX, y: event.clientY, pan: event.button === 2 || event.shiftKey };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('pointercancel', () => { drag = null; });
canvas.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (drag.pan) map.pan(dx, dy);
  else { map.yaw += dx * 0.006; map.pitch = Math.max(-1.35, Math.min(1.35, map.pitch + dy * 0.006)); }
  drag.x = event.clientX; drag.y = event.clientY; map.draw();
});
canvas.addEventListener('wheel', (event) => {
  event.preventDefault(); map.autoRotate = false;
  map.distance = Math.max(12, Math.min(110, map.distance * Math.exp(event.deltaY * 0.001)));
  map.draw();
}, { passive: false });
window.addEventListener('resize', () => map.resize());
if (new URLSearchParams(location.search).has('bench')) {
  map.autoRotate = false;
  await (await import('./bench.ts')).run(map, firstFrameMs);
} else {
  let previous = performance.now();
  function animate(now: number): void {
    if (map.autoRotate) { map.yaw += Math.min(100, now - previous) * 0.00087; map.draw(); }
    previous = now; requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);
}
