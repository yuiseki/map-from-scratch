import { CesiumGlobe } from './globe.ts';

declare global {
  interface Window {
    __globe?: CesiumGlobe;
  }
}

const canvas = document.getElementById('globe') as HTMLCanvasElement;
const globe = new CesiumGlobe(canvas);
window.__globe = globe;

const t0 = performance.now();
globe.load().then(() => {
  const firstFrameMs = performance.now() - t0;
  if (location.search.includes('bench')) {
    import('./bench.ts').then((b) => b.run(globe, firstFrameMs));
  }
});
