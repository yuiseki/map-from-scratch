import { CesiumPinsGlobe } from './globe.ts';

const canvas = document.getElementById('globe') as HTMLCanvasElement;
const globe = new CesiumPinsGlobe(canvas);
(window as unknown as { __globe: CesiumPinsGlobe }).__globe = globe;

const t0 = performance.now();
globe.load().then(() => {
  const firstFrameMs = performance.now() - t0;
  if (location.search.includes('bench')) {
    import('./bench.ts').then((b) => b.run(globe, firstFrameMs));
  }
});
