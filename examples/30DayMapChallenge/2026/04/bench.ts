import { benchFrames, emit, glRenderer, zoomPath } from '../../../../harness/page/bench.ts';
import type { ClusterMap } from './renderer.ts';

export async function run(map: ClusterMap, filterCount: number): Promise<void> {
  const { gl, stats } = map;
  gl.canvas.addEventListener('webglcontextlost', () => emit({ error: 'WebGL context lost' }));
  map.draw();
  const aggregate = map.inspectClusters();
  emit({ metric: 'first_frame_ms', value: performance.now() - map.startedAt });
  emit({ metric: 'facility_count', value: map.pointCount });
  emit({ metric: 'category_count', value: stats.categoryCounts.filter((n) => n > 0).length });
  emit({ metric: 'category_filter_count', value: filterCount });
  emit({ metric: 'occupied_cluster_cells', value: aggregate.occupied });
  emit({ info: { gpu: glRenderer(gl), facility_points: map.pointCount, category_counts: stats.categoryCounts, occupied_cells: aggregate.occupied, cluster_grid: map.gridSize(), boundary_segments: map.segmentCount } });
  emit({ check: 'source-count', pass: map.pointCount === stats.sourceFeatures && stats.sourceFeatures === 141092 && stats.categoryCounts.length === 4 && stats.categoryCounts.every((n) => n > 0) && stats.categoryCounts.reduce((a, b) => a + b, 0) === map.pointCount, detail: `${map.pointCount} points; category counts ${stats.categoryCounts.join('/')}` });
  emit({ check: 'gpu-cells', pass: aggregate.occupied >= 50 && aggregate.categories.every((n) => n > 0), detail: `${aggregate.occupied} occupied cells; per-category cells ${aggregate.categories.join('/')}; grid ${aggregate.dims.join('x')}; WebGL errors ${aggregate.errors.join(',') || 'none'}` });

  const buttons = [...document.querySelectorAll<HTMLButtonElement>('button[data-filter]')];
  let passedFilters = 0;
  for (let kind = 0; kind < 4; kind++) {
    buttons.find((button) => Number(button.dataset.filter) === kind)?.click();
    const filtered = map.inspectClusters();
    if (map.state.filter === kind && filtered.occupied > 0 && filtered.categories[kind]! > 0) passedFilters++;
  }
  buttons.find((button) => button.dataset.filter === '-1')?.click();
  emit({ check: 'category-filters', pass: passedFilters === 4 && map.state.filter === -1, detail: `${passedFilters}/4 category filters rendered; all categories restored` });

  const image = map.inspectImage();
  emit({ check: 'city-boundary', pass: map.segmentCount > 3000 && image.borderLike > 300, detail: `${map.segmentCount} boundary segments; ${image.borderLike} sampled line pixels` });
  emit({ check: 'clusters-visible', pass: image.bright > 30000, detail: `${image.bright} non-background pixels` });

  const path = zoomPath(80, { cx: 0.04, cy: -0.015, z0: 1, z1: 8, pan: 0.11 });
  await benchFrames(gl, path.length, (i) => {
    map.state.centerX = path[i]!.cx; map.state.centerY = path[i]!.cy; map.state.zoom = path[i]!.zoom; map.draw();
  });
  map.state.centerX = 0; map.state.centerY = 0; map.state.zoom = 1; map.draw();
  emit({ done: true });
}
