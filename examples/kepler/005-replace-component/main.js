import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/kepler-005-replace-component/earthquakes.bin', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
const headerSlot = document.getElementById('header-slot');
const extraSlot = document.getElementById('extra-slot');
const toggleBtn = document.getElementById('toggle-components-btn');
let isCustom = false;
export function renderDefaultComponents() {
    isCustom = false;
    headerSlot.innerHTML = `
    <div class="default-header">
      <span style="color: #00d1b2; font-weight: 900;">K</span> kepler.gl Default Header
    </div>
  `;
    extraSlot.innerHTML = ``;
    toggleBtn.textContent = 'Swap to Custom Components';
}
export function renderCustomComponents() {
    isCustom = true;
    headerSlot.innerHTML = `
    <div class="custom-header">
      <div class="custom-header-title">
        <span>USGS Seismic Hub</span>
        <span style="font-size: 10px; background: #00d1b2; color: #131519; padding: 2px 6px; border-radius: 3px; font-weight: 800;">Enterprise</span>
      </div>
      <span class="custom-header-sub">Custom Component Injection Active</span>
    </div>
  `;
    extraSlot.innerHTML = `
    <div class="custom-metrics-panel">
      <div class="metrics-title">Live Seismic Metrics</div>
      <div class="metrics-grid">
        <div class="metric-cell">
          <div class="metric-cell-label">Max Magnitude</div>
          <div class="metric-cell-val">M7.2</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-label">Total Records</div>
          <div class="metric-cell-val">54,936</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-label">Avg Depth</div>
          <div class="metric-cell-val">8.4 km</div>
        </div>
        <div class="metric-cell">
          <div class="metric-cell-label">Fault Lines</div>
          <div class="metric-cell-val">Active</div>
        </div>
      </div>
    </div>
  `;
    toggleBtn.textContent = 'Swap to Default Components';
}
toggleBtn.addEventListener('click', ()=>{
    if (isCustom) {
        renderDefaultComponents();
    } else {
        renderCustomComponents();
    }
});
export function getIsCustom() {
    return isCustom;
}
if (new URLSearchParams(location.search).has('bench')) {
    const benchModule = await import('./bench.js');
    await benchModule.run(map, firstFrameMs);
}
