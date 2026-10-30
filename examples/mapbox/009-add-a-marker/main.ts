import { MarkerMap } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new MarkerMap(canvas);
(window as unknown as { __map: MarkerMap }).__map = map;

const t0 = performance.now();
map.load().then(() => {
  const firstFrameMs = performance.now() - t0;
  if (location.search.includes('bench')) {
    import('./bench.ts').then((b) => b.run(map, firstFrameMs));
  }
});
