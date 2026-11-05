import { emit } from '../../../../harness/page/bench.ts';
import { type CollaborationMap } from './collaboration.ts';
import { CollaborationRenderer, MonthTimeline, drawTimelineMonthLabel, updateSelectionText } from './renderer.ts';

interface BenchmarkStats { inputFeatureCount: number; mappedFeatureCount: number; unmappedNoGeometry: number; cellCount: number; payloadBytes: number }

export async function run(renderer: CollaborationRenderer, timeline: MonthTimeline, data: CollaborationMap, stats: BenchmarkStats) {
  emit({ metric: 'input_features', value: stats.inputFeatureCount });
  emit({ metric: 'mapped_contributions', value: stats.mappedFeatureCount });
  emit({ metric: 'occupied_cells', value: stats.cellCount });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });
  emit({ metric: 'data_bytes', value: stats.payloadBytes });

  const body = document.body.innerText;
  const hrefs = [...document.querySelectorAll('a')].map((link) => link.href);
  const visibleAttribution = body.includes('OpenStreetMap contributors') && body.includes('ODbL 1.0')
    && hrefs.includes('https://www.openstreetmap.org/copyright')
    && hrefs.includes('https://opendatacommons.org/licenses/odbl/1-0/');
  emit({ check: 'openstreetmap-attribution-and-odbl', pass: visibleAttribution,
    detail: 'OpenStreetMap attribution and ODbL 1.0 license links are visible without interaction' });

  const queryDisclosure = body.includes('2025年') && body.includes('建物') && body.includes('約38 × 46 m')
    && body.includes('正確な範囲ではありません') && body.includes('編集者の人数')
    && body.includes('削除10件') && body.includes('手作業・自動編集') && body.includes('種別は1件で重なる');
  emit({ check: 'query-scope-and-privacy-disclosure', pass: queryDisclosure,
    detail: 'Year, feature filter, approximate grid, deletion omission and non-personal interpretation are disclosed' });

  const serialized = JSON.stringify(data);
  emit({ check: 'identifiers-stripped-from-render-data', pass: !serialized.includes('@osmId')
    && !serialized.includes('@contributionChangesetId') && !serialized.includes('user'),
    detail: 'Baked browser data includes only anonymous cell counts and monthly totals' });

  const externalResources = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-map-services', pass: externalResources.length === 0,
    detail: `external runtime resources: ${externalResources.length}` });

  const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
  const rect = renderer.rect;
  const groundAspect = ((data.bounds.east - data.bounds.west) * Math.cos((data.bounds.north + data.bounds.south) / 2 * Math.PI / 180))
    / (data.bounds.north - data.bounds.south);
  const screenAspect = rect.width / rect.height;
  emit({ check: 'local-ground-projection', pass: Math.abs(groundAspect - screenAspect) < 0.005,
    detail: `geographic aspect=${groundAspect}; screen aspect=${screenAspect}` });

  renderer.setMonth(11);
  timeline.draw(11); drawTimelineMonthLabel(document.getElementById('month-label')!, 11);
  const densest = data.cells.reduce((best, cell) => cell.months.reduce((sum, month) => sum + month.total, 0)
    > best.months.reduce((sum, month) => sum + month.total, 0) ? cell : best, data.cells[0]!);
  const cellWidth = rect.width / data.gridSize, cellHeight = rect.height / data.gridSize;
  const pointX = rect.x + (densest.x + 0.5) * cellWidth, pointY = rect.y + (densest.y + 0.5) * cellHeight;
  const pixelRatio = mapCanvas.width / mapCanvas.clientWidth;
  const pixel = mapCanvas.getContext('2d')!.getImageData(Math.floor(pointX * pixelRatio), Math.floor(pointY * pixelRatio), 1, 1).data;
  const occupiedKeys = new Set(data.cells.map((cell) => `${cell.x}:${cell.y}`));
  let emptyX = 0, emptyY = 0;
  while (occupiedKeys.has(`${emptyX}:${emptyY}`)) { emptyX = (emptyX + 1) % data.gridSize; if (emptyX === 0) emptyY++; }
  const emptyXpx = rect.x + (emptyX + 0.5) * cellWidth, emptyYpx = rect.y + (emptyY + 0.5) * cellHeight;
  const emptyPixel = mapCanvas.getContext('2d')!.getImageData(Math.floor(emptyXpx * pixelRatio), Math.floor(emptyYpx * pixelRatio), 1, 1).data;
  const activeLuma = pixel[0]! + pixel[1]! + pixel[2]!, emptyLuma = emptyPixel[0]! + emptyPixel[1]! + emptyPixel[2]!;
  emit({ check: 'real-contribution-cell-pixel', pass: activeLuma > emptyLuma + 25,
    detail: `occupied (${densest.x}, ${densest.y}) pixel=${[...pixel].join(',')}; empty (${emptyX}, ${emptyY})=${[...emptyPixel].join(',')}` });

  const monthInput = document.getElementById('month') as HTMLInputElement;
  monthInput.value = '6'; monthInput.dispatchEvent(new Event('input', { bubbles: true }));
  const monthChanged = document.getElementById('month-label')!.textContent === '2025年 7月までの累積'
    && monthInput.getAttribute('aria-valuenow') === '7';
  emit({ check: 'month-control-cumulative-map', pass: monthChanged && renderer.view.month === 6
    && data.cumulativeTotal(6) > 0, detail: `month=${renderer.view.month + 1}; cumulative=${data.cumulativeTotal(6)}` });

  const mapBounds = mapCanvas.getBoundingClientRect();
  mapCanvas.dispatchEvent(new PointerEvent('pointerdown', {
    clientX: pointX + mapBounds.left, clientY: pointY + mapBounds.top, bubbles: true,
  }));
  const pointerSelectedCell = renderer.view.selected?.x === densest.x && renderer.view.selected?.y === densest.y
    && document.getElementById('selected')!.textContent!.includes(`格子 ${densest.x + 1}, ${densest.y + 1}`);
  emit({ check: 'pointer-cell-selection', pass: pointerSelectedCell,
    detail: `pointer selected cell ${renderer.view.selected?.x},${renderer.view.selected?.y}` });

  renderer.view.selected = densest; renderer.draw(); updateSelectionText(document.getElementById('selected')!, renderer);
  const beforeText = document.getElementById('selected')!.textContent;
  mapCanvas.focus(); mapCanvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const keyboardMovesAndAnnounces = renderer.view.selected?.x === Math.min(data.gridSize - 1, densest.x + 1)
    && document.getElementById('selected')!.textContent !== beforeText;
  emit({ check: 'keyboard-cell-navigation', pass: keyboardMovesAndAnnounces,
    detail: 'Arrow keys move the selected geographic cell and update the live details' });

  const samples: number[] = [], frames: number[] = [];
  await new Promise(requestAnimationFrame);
  for (let i = 0; i < 96; i++) {
    renderer.view.month = i % 12;
    const started = performance.now(); renderer.draw(); timeline.draw(i % 12);
    samples.push(performance.now() - started);
    const frameStart = performance.now(); await new Promise(requestAnimationFrame); frames.push(performance.now() - frameStart);
  }
  emit({ metric: 'draw_cpu_ms', values: samples }); emit({ metric: 'frame_ms', values: frames });
  monthInput.value = '6'; monthInput.dispatchEvent(new Event('input', { bubbles: true }));
  emit({ info: { renderer: 'Dedicated Canvas 2D geographic-cell renderer', browserData: 'monthly anonymous grid counts', inputFeatures: stats.inputFeatureCount,
    mappedFeatures: stats.mappedFeatureCount, unlocated: stats.unmappedNoGeometry, occupiedCells: stats.cellCount,
    source: 'ohsome API v1 OpenStreetMap historical contribution centroid extraction', AOI: '139.696,35.650–139.706,35.660' } });
  emit({ done: true });
}
