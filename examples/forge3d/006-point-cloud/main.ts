import { Forge3dPointCloud } from './cloud.ts';

const canvas = document.getElementById('map') as HTMLCanvasElement;
const cloud = new Forge3dPointCloud(canvas);
(window as unknown as { __map: Forge3dPointCloud }).__map = cloud;

await cloud.load();

if (location.search.includes('bench')) {
  await import('./bench.ts');
}
