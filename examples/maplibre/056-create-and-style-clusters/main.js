import { mount } from './clusters.js';
const started = performance.now();
const canvas = document.getElementById('map');
const labels = document.getElementById('labels');
const land = document.getElementById('land');
const map = await mount(canvas, labels, land, '../../../data/baked/maplibre-056-create-and-style-clusters/earthquakes.bin', '../../../data/baked/maplibre-056-create-and-style-clusters/land.json');
map.gl.readPixels(0, 0, 1, 1, map.gl.RGBA, map.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(map, firstFrameMs);
