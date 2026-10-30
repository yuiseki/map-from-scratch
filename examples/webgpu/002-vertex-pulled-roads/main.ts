// examples/webgpu/002-vertex-pulled-roads/main.ts
import { mount, type RoadMap } from './map.ts';

declare global {
  interface Window {
    __roadMap?: RoadMap;
  }
}

async function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const countEl = document.getElementById('count-val');

  const startTime = performance.now();
  const dataUrl = '../../../data/baked/webgpu-002-vertex-pulled-roads/roads.bin';
  const map = await mount(canvas, dataUrl);
  const firstFrameMs = performance.now() - startTime;

  window.__roadMap = map;

  if (countEl) {
    countEl.textContent = `${map.roadCount.toLocaleString()} / ${map.segmentCount.toLocaleString()}`;
  }

  if (location.search.includes('bench')) {
    const { runBench } = await import('./bench.ts');
    await runBench(map, firstFrameMs);
  }
}

init().catch(err => {
  console.error('Initialization error:', err);
  const hud = document.getElementById('hud');
  if (hud) {
    hud.innerHTML = `<span style="color:#ef4444">WebGPU Error: ${err.message}</span>`;
  }
  if ((window as any).__mfsEmit) {
    (window as any).__mfsEmit(JSON.stringify({ error: err?.message || String(err) }));
  }
  throw err;
});
