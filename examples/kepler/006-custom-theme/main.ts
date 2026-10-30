// examples/kepler/006-custom-theme/main.ts
import { mount, type KeplerMap, type ThemeMode } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map-canvas') as HTMLCanvasElement;
const dataUrl = new URL('../../../data/baked/kepler-006-custom-theme/earthquakes.bin', import.meta.url).href;

const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;

const themeToggleBtn = document.getElementById('theme-toggle-btn')!;
const themeName = document.getElementById('theme-name')!;

export function applyTheme(mode: ThemeMode) {
  document.body.className = `theme-${mode}`;
  map.setTheme(mode);
  if (mode === 'dark') {
    themeToggleBtn.textContent = 'Switch to Light Theme';
    themeName.textContent = 'Dark Theme';
  } else {
    themeToggleBtn.textContent = 'Switch to Dark Theme';
    themeName.textContent = 'Light Theme';
  }
}

themeToggleBtn.addEventListener('click', () => {
  const current = map.getTheme();
  applyTheme(current === 'dark' ? 'light' : 'dark');
});

if (new URLSearchParams(location.search).has('bench')) {
  const benchModule = await import('./bench.ts');
  await benchModule.run(map, firstFrameMs, applyTheme);
}
