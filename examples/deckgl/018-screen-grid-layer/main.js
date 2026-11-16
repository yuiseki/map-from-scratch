import { mount } from './grid.js';
const started = performance.now();
const canvas = document.getElementById('map');
const grid = await mount(canvas, '../../../data/baked/deckgl-018-screen-grid-layer/points.bin');
const status = document.getElementById('status');
const slider = document.getElementById('cell-size');
const value = document.getElementById('cell-size-value');
status.textContent = `${grid.points.toLocaleString('ja-JP')} 地点 · 重み合計 ${grid.totalWeight.toLocaleString('ja-JP')}`;
grid.gl.readPixels(0, 0, 1, 1, grid.gl.RGBA, grid.gl.UNSIGNED_BYTE, new Uint8Array(4));
const firstFrameMs = performance.now() - started;
slider.addEventListener('input', ()=>{
    const size = Number(slider.value);
    grid.setCellSize(size);
    value.textContent = `${size} px`;
});
if (new URLSearchParams(location.search).has('bench')) await (await import('./bench.js')).run(grid, firstFrameMs);
