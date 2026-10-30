import { CesiumPointsGlobe } from './globe.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const globe = new CesiumPointsGlobe(canvas);
(window as unknown as { __map: CesiumPointsGlobe }).__map = globe;

await globe.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
