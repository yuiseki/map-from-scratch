import { OpenGlobusVectorGlobe } from './globe.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const globe = new OpenGlobusVectorGlobe(canvas);
(window as unknown as { __map: OpenGlobusVectorGlobe }).__map = globe;

await globe.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
