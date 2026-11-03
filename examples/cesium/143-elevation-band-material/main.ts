import { ElevationRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const autoRotateCheck = document.getElementById('autoRotate') as HTMLInputElement;
const paletteSelect = document.getElementById('palette') as HTMLSelectElement;
const contoursSelect = document.getElementById('contours') as HTMLSelectElement;

const renderer = new ElevationRenderer(canvas);
(window as unknown as { __mfsRenderer: ElevationRenderer }).__mfsRenderer = renderer;

autoRotateCheck.addEventListener('change', () => {
  renderer.state.autoRotate = autoRotateCheck.checked;
});

paletteSelect.addEventListener('change', () => {
  renderer.state.paletteMode = parseInt(paletteSelect.value, 10);
});

contoursSelect.addEventListener('change', () => {
  renderer.state.contourInterval = parseFloat(contoursSelect.value);
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
  import('./bench.ts').then((mod) => mod.run());
}
