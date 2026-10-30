import { MaplibreHeatmapMap } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new MaplibreHeatmapMap(canvas);
(window as unknown as { __map: MaplibreHeatmapMap }).__map = map;

await map.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
