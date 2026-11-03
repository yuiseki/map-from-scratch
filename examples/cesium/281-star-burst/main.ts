import { StarBurstRenderer } from './render.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const fpsEl = document.getElementById('fps') as HTMLDivElement;
const warpSlider = document.getElementById('warpSlider') as HTMLInputElement;
const streakSlider = document.getElementById('streakSlider') as HTMLInputElement;
const autoRotateCheck = document.getElementById('autoRotate') as HTMLInputElement;

const renderer = new StarBurstRenderer(canvas);
(window as unknown as { __mfsRenderer: StarBurstRenderer }).__mfsRenderer = renderer;

warpSlider.addEventListener('input', () => {
  renderer.state.warpSpeed = parseFloat(warpSlider.value);
});

streakSlider.addEventListener('input', () => {
  renderer.state.streakLength = parseFloat(streakSlider.value);
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
