import { mount, type PopupMap } from './popup.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const t0 = performance.now();

mount(canvas).then((map: PopupMap) => {
  (window as unknown as { __map: PopupMap }).__map = map;
  const firstFrameMs = performance.now() - t0;
  if (location.search.includes('bench')) {
    import('./bench.ts').then((b) => b.run(map, firstFrameMs));
  }
});
