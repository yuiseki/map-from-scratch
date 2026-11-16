import { mount } from './renderer.js';
const canvas = document.getElementById('map');
try {
    const map = await mount(canvas, '../../../../data/baked/30DayMapChallenge-2026-09');
    const { stats } = map;
    document.getElementById('counts').textContent = `${stats.cells.toLocaleString()} 格子 · 2020年の推計 · 30秒格子`;
    document.getElementById('population').textContent = `${stats.populationCells.toLocaleString()} 人口値あり · ${stats.builtOnlyCells.toLocaleString()} 建成地のみ`;
    if (new URLSearchParams(location.search).has('bench')) {
        const { run } = await import('./bench.js');
        await run(map);
    }
} catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML('beforeend', `<pre class="error">${String(error)}</pre>`);
}
