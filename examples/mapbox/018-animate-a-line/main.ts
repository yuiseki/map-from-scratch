import { MapboxAnimatedLineMap } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new MapboxAnimatedLineMap(canvas);
(window as unknown as { __map: MapboxAnimatedLineMap }).__map = map;

await map.load();
map.startAnimation();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
