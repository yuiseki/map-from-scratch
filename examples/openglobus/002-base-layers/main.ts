import { BaseLayerMap } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new BaseLayerMap(canvas);
(window as unknown as { __map: BaseLayerMap }).__map = map;

const btnOsm = document.getElementById('btn-osm') as HTMLButtonElement;
const btnSat = document.getElementById('btn-sat') as HTMLButtonElement;

btnOsm?.addEventListener('click', () => {
  map.setLayer('osm');
  btnOsm.classList.add('active');
  btnSat.classList.remove('active');
});

btnSat?.addEventListener('click', () => {
  map.setLayer('satellite');
  btnSat.classList.add('active');
  btnOsm.classList.remove('active');
});

const t0 = performance.now();
map.load().then(() => {
  const firstFrameMs = performance.now() - t0;
  if (location.search.includes('bench')) {
    import('./bench.ts').then((b) => b.run(map, firstFrameMs));
  }
});
