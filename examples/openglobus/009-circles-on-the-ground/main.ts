import { CirclesMap } from './map.ts';

const started = performance.now();
const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new CirclesMap(canvas);
await map.load();
const firstFrameMs = performance.now() - started;

if (new URLSearchParams(location.search).has('bench')) {
  await (await import('./bench.ts')).run(map, firstFrameMs);
}
