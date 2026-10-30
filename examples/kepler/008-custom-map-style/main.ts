// examples/kepler/008-custom-map-style/main.ts
import { mount } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const dataUrl = new URL('../../../data/baked/kepler-008-custom-map-style/earthquakes.bin', import.meta.url).href;

const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;

// Style Cards Selection
const styleCards = document.querySelectorAll('.style-card');
const legendGradient = document.getElementById('legend-gradient')!;

const GRADIENTS: Record<string, string> = {
  dark: 'linear-gradient(to right, #fae037, #b81c70)',
  light: 'linear-gradient(to right, #2563eb, #dc2626)',
  navy: 'linear-gradient(to right, #06b6d4, #f43f5e)',
  desert: 'linear-gradient(to right, #f59e0b, #b91c1c)',
};

styleCards.forEach((card) => {
  card.addEventListener('click', () => {
    styleCards.forEach((c) => c.classList.remove('active'));
    card.classList.add('active');
    const styleKey = card.getAttribute('data-style') || 'dark';
    map.setStyle(styleKey);
    if (GRADIENTS[styleKey]) {
      legendGradient.style.background = GRADIENTS[styleKey];
    }
  });
});

// Layer Toggles
const toggleLand = document.getElementById('toggle-land') as HTMLInputElement;
toggleLand.addEventListener('change', () => {
  map.setLayerVisibility('land', toggleLand.checked);
});

const toggleBorders = document.getElementById('toggle-borders') as HTMLInputElement;
toggleBorders.addEventListener('change', () => {
  map.setLayerVisibility('borders', toggleBorders.checked);
});

const togglePoints = document.getElementById('toggle-points') as HTMLInputElement;
togglePoints.addEventListener('change', () => {
  map.setLayerVisibility('points', togglePoints.checked);
});

// Benchmark runner attachment
if (window.location.search.includes('bench')) {
  import('./bench.ts').then((mod) => mod.runBench(map, firstFrameMs));
}
