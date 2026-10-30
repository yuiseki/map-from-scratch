import { MapboxAntPathMap } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new MapboxAntPathMap(canvas);
await map.load();

const firstFrameMs = performance.now() - started;
map.startAnimation();

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
