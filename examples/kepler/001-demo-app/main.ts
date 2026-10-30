// examples/kepler/001-demo-app/main.ts
import { mount } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const dataUrl = new URL('../../../data/baked/kepler-001-demo-app/earthquakes.bin', import.meta.url).href;

const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;

// 1. Sidebar collapse toggle
const sidebar = document.getElementById('sidebar')!;
const collapseBtn = document.getElementById('sidebar-collapse-btn')!;
collapseBtn.addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
  collapseBtn.textContent = sidebar.classList.contains('collapsed') ? '▶' : '◀';
  setTimeout(() => {
    map.resize();
  }, 220);
});

// 2. Tab Navigation
const tabs = document.querySelectorAll('.nav-tab');
const panels = document.querySelectorAll('.panel');
tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => t.classList.remove('active'));
    panels.forEach((p) => p.classList.remove('active'));

    tab.classList.add('active');
    const targetTab = tab.getAttribute('data-tab');
    const targetPanel = document.getElementById(`panel-${targetTab}`);
    if (targetPanel) {
      targetPanel.classList.add('active');
    }
  });
});

// 3. Layer visibility toggle
const layerToggle = document.getElementById('layer-toggle-earthquakes')!;
let isVisible = true;
layerToggle.addEventListener('click', () => {
  isVisible = !isVisible;
  layerToggle.classList.toggle('hidden', !isVisible);
  layerToggle.textContent = isVisible ? '👁' : '─';
  map.setLayerVisible(isVisible);
});

// 4. Magnitude filter slider
const magSlider = document.getElementById('mag-filter-slider') as HTMLInputElement;
const magVal = document.getElementById('mag-filter-val')!;
magSlider.addEventListener('input', () => {
  const val = parseFloat(magSlider.value);
  magVal.textContent = `Min Magnitude: ≥ ${val.toFixed(1)}`;
  map.setMinMagnitude(val);
});

// 5. 3D pitch toggle
const pitchToggle = document.getElementById('pitch-toggle')!;
pitchToggle.addEventListener('click', () => {
  const current = map.getPitch();
  const next = current > 0 ? 0 : 0.785398; // 0 or 45 degrees
  map.setPitch(next);
  pitchToggle.classList.toggle('active', next > 0);
});

// 6. Legend toggle
const legendToggle = document.getElementById('legend-toggle')!;
const legend = document.getElementById('legend')!;
legendToggle.addEventListener('click', () => {
  const isShowing = legend.style.display !== 'none';
  legend.style.display = isShowing ? 'none' : 'flex';
  legendToggle.classList.toggle('active', !isShowing);
});

if (new URLSearchParams(location.search).has('bench')) {
  const benchModule = await import('./bench.ts');
  await benchModule.run(map, firstFrameMs);
}
