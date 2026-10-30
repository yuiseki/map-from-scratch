// examples/opfs/001-offline-pmtiles/main.ts
import { mount, type OpfsMap } from './map.ts';

declare global {
  interface Window {
    __opfsMap?: OpfsMap;
  }
}

async function init() {
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;
  const readsEl = document.getElementById('reads-val');
  const latencyEl = document.getElementById('latency-val');
  const netEl = document.getElementById('net-val');

  const startTime = performance.now();
  const archiveUrl = '../../../data/baked/opfs-001-offline-pmtiles/world.pmtiles';
  const map = await mount(canvas, archiveUrl);
  const firstFrameMs = performance.now() - startTime;

  window.__opfsMap = map;

  async function updateHud() {
    const stats = await map.getStats();
    if (readsEl) readsEl.textContent = `${stats.totalSyncReads} reads`;
    if (latencyEl) latencyEl.textContent = `${(stats.avgLatencyMs * 1000).toFixed(1)} µs`;
    if (netEl) netEl.textContent = `${stats.networkRequests} HTTP (Offline)`;
  }

  map.onTileLoaded = () => {
    updateHud();
  };

  await updateHud();

  if (location.search.includes('bench')) {
    const { runBench } = await import('./bench.ts');
    await runBench(map, firstFrameMs);
  }
}

init().catch(err => {
  console.error('Initialization error:', err);
  const hud = document.getElementById('hud');
  if (hud) {
    hud.innerHTML = `<span style="color:#ef4444">OPFS Error: ${err.message}</span>`;
  }
  if ((window as any).__mfsEmit) {
    (window as any).__mfsEmit(JSON.stringify({ error: err?.message || String(err) }));
  }
  throw err;
});
