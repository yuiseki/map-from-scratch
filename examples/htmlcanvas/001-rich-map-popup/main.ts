// Main entry point for htmlcanvas-001-rich-map-popup
import { mount, type MapPopupView } from './map.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const hudStatus = document.getElementById('hud-status');
const hudAnchor = document.getElementById('hud-anchor');
const hudBookmark = document.getElementById('hud-bookmark');

function resize(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', () => {
  resize();
  if (mapInstance) {
    mapInstance.render();
  }
});
resize();

const DATA_URL = '../../../data/baked/htmlcanvas-001-rich-map-popup/landmarks.json';

const startTime = performance.now();
const mapInstance = await mount(canvas, DATA_URL);
const firstFrameMs = performance.now() - startTime;

function updateHud(): void {
  if (hudStatus) {
    hudStatus.textContent = mapInstance.hasDrawElementImage
      ? 'HTML-in-Canvas Active'
      : 'Fallback Active (No drawElementImage)';
    hudStatus.style.color = mapInstance.hasDrawElementImage ? '#4ade80' : '#f59e0b';
  }
  if (hudAnchor) hudAnchor.textContent = mapInstance.activeLandmark.name;
  if (hudBookmark) {
    hudBookmark.textContent = mapInstance.bookmarked ? 'Saved ✓' : 'No';
    hudBookmark.style.color = mapInstance.bookmarked ? '#4ade80' : '#94a3b8';
  }
}

const originalRender = mapInstance.render;
mapInstance.render = async () => {
  await originalRender();
  updateHud();
};
updateHud();

// Benchmark hook
if (new URLSearchParams(window.location.search).has('bench')) {
  const { runBench } = await import('./bench.ts');
  await runBench(mapInstance, firstFrameMs);
}
