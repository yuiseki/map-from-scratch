import { mount } from './map.js';
export function appReducer(state, action) {
    switch(action.type){
        case 'SET_FILTER':
            return {
                ...state,
                minMagnitude: action.minMag,
                lastAction: `SET_FILTER(${action.minMag})`
            };
        case 'SET_VIEW':
            return {
                ...state,
                viewPreset: action.label,
                lastAction: `SET_VIEW(${action.label})`
            };
        case 'TOGGLE_SIDEBAR':
            return {
                ...state,
                sidebarOpen: !state.sidebarOpen,
                lastAction: 'TOGGLE_SIDEBAR'
            };
        default:
            return state;
    }
}
const started = performance.now();
const canvas = document.getElementById('map-canvas');
const dataUrl = new URL('../../../data/baked/kepler-003-custom-reducer/earthquakes.bin', import.meta.url).href;
const map = await mount(canvas, dataUrl);
const firstFrameMs = performance.now() - started;
let currentState = {
    minMagnitude: 2.5,
    viewPreset: 'Full CA',
    sidebarOpen: true,
    lastAction: 'INIT'
};
const stMinMag = document.getElementById('st-min-mag');
const stView = document.getElementById('st-view');
const stSidebar = document.getElementById('st-sidebar');
const stAction = document.getElementById('st-action');
const actionLog = document.getElementById('action-log');
const sidebar = document.getElementById('sidebar');
export function dispatch(action) {
    currentState = appReducer(currentState, action);
    if (action.type === 'SET_FILTER') {
        map.setMinMagnitude(action.minMag);
    } else if (action.type === 'SET_VIEW') {
        map.setCenter(action.lng, action.lat);
        map.setZoom(action.zoom);
    } else if (action.type === 'TOGGLE_SIDEBAR') {
        sidebar.classList.toggle('collapsed', !currentState.sidebarOpen);
        setTimeout(()=>map.resize(), 220);
    }
    stMinMag.textContent = currentState.minMagnitude.toFixed(1);
    stView.textContent = currentState.viewPreset;
    stSidebar.textContent = String(currentState.sidebarOpen);
    stAction.textContent = currentState.lastAction;
    const logEntry = document.createElement('div');
    logEntry.className = 'log-entry';
    logEntry.innerHTML = `● <span class="action-name">${action.type}</span>`;
    actionLog.appendChild(logEntry);
    actionLog.scrollTop = actionLog.scrollHeight;
}
const btnFilterAll = document.getElementById('btn-filter-all');
const btnFilterMod = document.getElementById('btn-filter-mod');
const btnFilterStr = document.getElementById('btn-filter-str');
function setFilterActive(activeBtn) {
    [
        btnFilterAll,
        btnFilterMod,
        btnFilterStr
    ].forEach((b)=>b.classList.remove('active'));
    activeBtn.classList.add('active');
}
btnFilterAll.addEventListener('click', ()=>{
    setFilterActive(btnFilterAll);
    dispatch({
        type: 'SET_FILTER',
        minMag: 2.5,
        label: 'All'
    });
});
btnFilterMod.addEventListener('click', ()=>{
    setFilterActive(btnFilterMod);
    dispatch({
        type: 'SET_FILTER',
        minMag: 4.0,
        label: 'Mod'
    });
});
btnFilterStr.addEventListener('click', ()=>{
    setFilterActive(btnFilterStr);
    dispatch({
        type: 'SET_FILTER',
        minMag: 5.5,
        label: 'Strong'
    });
});
const btnViewCa = document.getElementById('btn-view-ca');
const btnViewBay = document.getElementById('btn-view-bay');
const btnViewSocal = document.getElementById('btn-view-socal');
function setViewActive(activeBtn) {
    [
        btnViewCa,
        btnViewBay,
        btnViewSocal
    ].forEach((b)=>b.classList.remove('active'));
    activeBtn.classList.add('active');
}
btnViewCa.addEventListener('click', ()=>{
    setViewActive(btnViewCa);
    dispatch({
        type: 'SET_VIEW',
        lng: -122.8,
        lat: 37.0,
        zoom: 5.75,
        label: 'Full CA'
    });
});
btnViewBay.addEventListener('click', ()=>{
    setViewActive(btnViewBay);
    dispatch({
        type: 'SET_VIEW',
        lng: -122.3,
        lat: 37.8,
        zoom: 8.5,
        label: 'Bay Area'
    });
});
btnViewSocal.addEventListener('click', ()=>{
    setViewActive(btnViewSocal);
    dispatch({
        type: 'SET_VIEW',
        lng: -118.2,
        lat: 34.0,
        zoom: 8.0,
        label: 'SoCal'
    });
});
const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
btnToggleSidebar.addEventListener('click', ()=>{
    dispatch({
        type: 'TOGGLE_SIDEBAR'
    });
});
export function getState() {
    return currentState;
}
if (new URLSearchParams(location.search).has('bench')) {
    const benchModule = await import('./bench.js');
    await benchModule.run(map, firstFrameMs, dispatch, getState);
}
