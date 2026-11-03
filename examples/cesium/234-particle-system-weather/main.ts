import { WeatherRenderer } from './render.ts';
import type { WeatherType } from './weather.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const weatherTypeSelect = document.getElementById('weatherType') as HTMLSelectElement;
const windSlider = document.getElementById('windSlider') as HTMLInputElement;
const autoRotateCheck = document.getElementById('autoRotate') as HTMLInputElement;

const renderer = new WeatherRenderer(canvas);
(window as unknown as { __mfsRenderer: WeatherRenderer }).__mfsRenderer = renderer;

weatherTypeSelect.addEventListener('change', () => {
  renderer.setWeatherType(weatherTypeSelect.value as WeatherType);
});

windSlider.addEventListener('input', () => {
  renderer.state.windSpeed = parseFloat(windSlider.value);
});

autoRotateCheck.addEventListener('change', () => {
  renderer.state.autoRotate = autoRotateCheck.checked;
});

let lastTime = performance.now();
let frames = 0;
let lastFpsUpdate = lastTime;

function frame(now: number): void {
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  renderer.render(dt);

  frames++;
  if (now - lastFpsUpdate >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastFpsUpdate));
    fpsEl.textContent = `FPS: ${fps}`;
    frames = 0;
    lastFpsUpdate = now;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

if (location.search.includes('bench')) {
  import('./bench.ts');
}
