import { CloudsRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const windSlider = document.getElementById('windSlider') as HTMLInputElement;
const sunSlider = document.getElementById('sunSlider') as HTMLInputElement;
const autoDriftCheck = document.getElementById('autoDrift') as HTMLInputElement;

const renderer = new CloudsRenderer(canvas);
(window as unknown as { __mfsRenderer: CloudsRenderer }).__mfsRenderer = renderer;

windSlider.addEventListener('input', () => {
  renderer.state.windSpeed = parseFloat(windSlider.value);
});

sunSlider.addEventListener('input', () => {
  renderer.state.sunAngle = parseFloat(sunSlider.value);
});

autoDriftCheck.addEventListener('change', () => {
  renderer.state.autoDrift = autoDriftCheck.checked;
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
