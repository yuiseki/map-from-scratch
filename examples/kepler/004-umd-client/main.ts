// examples/kepler/004-umd-client/main.ts
import { mount, type KeplerMap } from './map.ts';

export interface UMDClientOptions {
  dataUrl: string;
}

export const KeplerGl = {
  async mount(target: string | HTMLElement, options: UMDClientOptions): Promise<KeplerMap> {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`Mount target not found: ${target}`);

    el.innerHTML = `
      <div class="kepler-app">
        <div class="kepler-sidebar">
          <div class="kepler-header">
            <div class="kepler-badge">K</div>
            <span>kepler.gl UMD</span>
          </div>
          <div class="kepler-tabs">
            <div class="kepler-tab active">Layers</div>
            <div class="kepler-tab">Filters</div>
          </div>
          <div class="kepler-body">
            <div class="kepler-card">
              <div class="kepler-card-title">
                <span>earthquakes</span>
                <span style="font-size: 10px; color: #8c96a5;">Point</span>
              </div>
              <div class="kepler-ramp"></div>
              <div class="kepler-meta">
                <span>Mag 2.5 - 7.2</span>
                <span>54,936 pts</span>
              </div>
            </div>
          </div>
        </div>
        <div class="kepler-map-area">
          <div class="umd-pill">UMD Client Active</div>
          <canvas class="kepler-canvas"></canvas>
          <div class="kepler-legend">
            <span class="legend-title">Magnitude</span>
            <div class="legend-gradient"></div>
            <div class="legend-ticks">
              <span>2.5</span>
              <span>4.5</span>
              <span>6.5+</span>
            </div>
          </div>
        </div>
      </div>
    `;

    const canvas = el.querySelector('.kepler-canvas') as HTMLCanvasElement;
    return await mount(canvas, options.dataUrl);
  },
};

const started = performance.now();
const dataUrl = new URL('../../../data/baked/kepler-004-umd-client/earthquakes.bin', import.meta.url).href;
const map = await KeplerGl.mount('#kepler-container', { dataUrl });
const firstFrameMs = performance.now() - started;

(window as unknown as { KeplerGl: typeof KeplerGl }).KeplerGl = KeplerGl;

if (new URLSearchParams(location.search).has('bench')) {
  const benchModule = await import('./bench.ts');
  await benchModule.run(map, firstFrameMs);
}
