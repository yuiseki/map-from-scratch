import { TangramHighwaysMap } from './map.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const map = new TangramHighwaysMap(canvas);
(window as unknown as { __map: TangramHighwaysMap }).__map = map;

await map.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
