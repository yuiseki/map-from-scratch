import { mount } from './density.js';
const map = await mount(document.getElementById('map'), '../../data/baked/04-osm-node-density/nodes.bin');
const mounted = performance.now();
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, mounted);
