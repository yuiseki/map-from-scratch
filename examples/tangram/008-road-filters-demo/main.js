import { mount } from './map.js';
const started = performance.now();
const canvas = document.getElementById('map');
const status = document.getElementById('status');
const chkInterstate = document.getElementById('chk-interstate');
const chkUS = document.getElementById('chk-us');
const chkSR = document.getElementById('chk-sr');
const searchInput = document.getElementById('search-input');
const map = await mount(canvas, '../../../data/baked/tangram-008-road-filters-demo/roads.json');
const firstFrameMs = performance.now() - started;
function updateStatus() {
    status.textContent = `表示中: ${map.visibleRoadCount.toLocaleString()} 本 / 全 ${map.roadCount.toLocaleString()} 本`;
}
updateStatus();
function applyFilters() {
    map.setFilters({
        interstate: chkInterstate.checked,
        usHighway: chkUS.checked,
        stateRoute: chkSR.checked,
        search: searchInput.value
    });
    updateStatus();
}
chkInterstate.addEventListener('change', applyFilters);
chkUS.addEventListener('change', applyFilters);
chkSR.addEventListener('change', applyFilters);
searchInput.addEventListener('input', applyFilters);
if (new URLSearchParams(location.search).has('bench')) {
    const benchModule = await import('./bench.js');
    await benchModule.run(map, firstFrameMs);
}
