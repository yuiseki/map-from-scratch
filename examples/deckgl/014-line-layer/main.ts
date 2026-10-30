import { LineLayerMap } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new LineLayerMap(canvas);
await map.load();

const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
