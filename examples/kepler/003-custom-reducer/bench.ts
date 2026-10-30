// examples/kepler/003-custom-reducer/bench.ts
import { emit, glRenderer } from '../../../harness/page/bench.ts';
import type { KeplerMap } from './map.ts';
import type { Action, AppState } from './main.ts';

export async function run(
  map: KeplerMap,
  firstFrameMs: number,
  dispatch: (action: Action) => void,
  getState: () => AppState,
): Promise<void> {
  emit({ info: { gpu: glRenderer(map.gl), points: map.pointCount } });
  await new Promise(requestAnimationFrame);
  emit({ metric: 'first_frame_ms', value: firstFrameMs });

  // 1. Verification: initial-reducer-state
  const initSt = getState();
  emit({
    check: 'initial-reducer-state',
    pass: initSt.minMagnitude === 2.5 && initSt.sidebarOpen === true && initSt.viewPreset === 'Full CA',
    detail: `minMag=${initSt.minMagnitude}, sidebarOpen=${initSt.sidebarOpen}, viewPreset=${initSt.viewPreset}`,
  });

  // 2. Verification: dispatch-filter-action
  dispatch({ type: 'SET_FILTER', minMag: 5.5, label: 'Strong' });
  const filterPass = map.getMinMagnitude() === 5.5 && getState().minMagnitude === 5.5;
  emit({
    check: 'dispatch-filter-action',
    pass: filterPass,
    detail: `mapMinMag=${map.getMinMagnitude()}, stateMinMag=${getState().minMagnitude}`,
  });

  // 3. Verification: dispatch-view-action
  dispatch({ type: 'SET_VIEW', lng: -122.3, lat: 37.8, zoom: 8.5, label: 'Bay Area' });
  const viewPass = map.getZoom() === 8.5 && getState().viewPreset === 'Bay Area';
  emit({
    check: 'dispatch-view-action',
    pass: viewPass,
    detail: `mapZoom=${map.getZoom()}, stateView=${getState().viewPreset}`,
  });

  // 4. Verification: dispatch-toggle-sidebar
  dispatch({ type: 'TOGGLE_SIDEBAR' });
  const sidebarPass = getState().sidebarOpen === false;
  emit({
    check: 'dispatch-toggle-sidebar',
    pass: sidebarPass,
    detail: `sidebarOpen=${getState().sidebarOpen}`,
  });

  // 5. Pan benchmark
  const redrawTimes: number[] = [];
  const intervals: number[] = [];
  let lastFrameTime = performance.now();

  for (let f = 0; f < 60; f++) {
    const start = performance.now();
    map.panBy(3, 1);
    const end = performance.now();
    redrawTimes.push(end - start);

    await new Promise(requestAnimationFrame);
    const now = performance.now();
    intervals.push(now - lastFrameTime);
    lastFrameTime = now;
  }

  redrawTimes.sort((a, b) => a - b);
  intervals.sort((a, b) => a - b);

  const p95Redraw = redrawTimes[Math.floor(redrawTimes.length * 0.95)];
  const p95Interval = intervals[Math.floor(intervals.length * 0.95)];

  emit({ metric: 'redraw_ms', values: redrawTimes });
  emit({ metric: 'frame_interval_ms', values: intervals });

  emit({
    check: 'pan-and-zoom',
    pass: p95Redraw < 16.0,
    detail: `p95Redraw=${p95Redraw.toFixed(2)}ms, p95Interval=${p95Interval.toFixed(2)}ms`,
  });

  emit({ done: true });
}
