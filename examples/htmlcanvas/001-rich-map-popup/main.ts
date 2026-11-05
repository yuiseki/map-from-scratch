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
resize();

const DATA_URL = '../../../data/baked/htmlcanvas-001-rich-map-popup/landmarks.json';

const startTime = performance.now();
// The first frame is drawn inside mount(), before it returns: the HUD reads
// the map through this variable, unset until then (a const would throw in its
// temporal dead zone).
let view: MapPopupView | null = null;
const mapInstance: MapPopupView = view = await mount(canvas, DATA_URL, () => updateHud());
const firstFrameMs = performance.now() - startTime;
// Registered after mount: a resize during the await read mapInstance in its
// temporal dead zone and threw.
window.addEventListener('resize', () => {
  resize();
  mapInstance.render();
});

function updateHud(): void {
  const mapInstance = view;
  if (!mapInstance) return;
  if (hudStatus) {
    hudStatus.textContent = mapInstance.htmlInCanvas
      ? 'HTML-in-Canvas (drawElementImage)'
      : 'DOM overlay (this browser has no HTML-in-Canvas)';
    hudStatus.style.color = mapInstance.htmlInCanvas ? '#4ade80' : '#f59e0b';
  }
  if (hudAnchor) hudAnchor.textContent = mapInstance.activeLandmark.name;
  if (hudBookmark) {
    hudBookmark.textContent = mapInstance.bookmarked ? 'Saved ✓' : 'No';
    hudBookmark.style.color = mapInstance.bookmarked ? '#4ade80' : '#94a3b8';
  }
}
updateHud();

// Benchmark hook
if (new URLSearchParams(window.location.search).has('bench')) {
  const { runBench } = await import('./bench.ts');
  await runBench(mapInstance, firstFrameMs);
}
