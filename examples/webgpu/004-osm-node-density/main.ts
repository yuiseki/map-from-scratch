import { mount } from './density.ts';
// index.html holds the canvas. The points are 04-osm-node-density's file.
const map = await mount(document.getElementById('map') as HTMLCanvasElement, '../../../data/baked/04-osm-node-density/nodes.bin');

const mounted = performance.now();
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.ts')).run(map, mounted);
