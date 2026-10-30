import { SunGlobe } from './globe.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const globe = new SunGlobe(canvas);
(window as unknown as { __map: SunGlobe }).__map = globe;
await globe.load();
const firstFrameMs = performance.now() - started;

const slider = document.getElementById('sun') as HTMLInputElement;
const out = document.getElementById('sunOut') as HTMLOutputElement;
const showSun = (): void => {
  const lon = Number(slider.value);
  globe.setSun(lon);
  out.textContent = `${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`;
};
slider.addEventListener('input', showSun);
showSun();

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(globe, firstFrameMs);
}
