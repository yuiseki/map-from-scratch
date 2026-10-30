import { MapPlate } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const plate = new MapPlate(canvas);
(window as unknown as { __map: MapPlate }).__map = plate;

await plate.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
