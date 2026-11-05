import { emit } from '../../../../harness/page/bench.ts';
import { frameIntervals } from './frame-metrics.ts';
import type { CellStatus, NullCell } from './nullmap.ts';
import type { NullRenderer } from './renderer.ts';

function sample(renderer: NullRenderer, cell: NullCell): number[] | null {
  const point = renderer.canvasPoint(cell.code);
  if (!point) return null;
  const ratio = renderer.canvas.width / renderer.canvas.clientWidth;
  return [...renderer.canvas.getContext('2d')!.getImageData(Math.floor(point.x * ratio), Math.floor(point.y * ratio), 1, 1).data];
}

export async function run(renderer: NullRenderer) {
  const stats = renderer.stats as {
    counts: Record<CellStatus, number> & { lattice: number; sourceRowsInBounds: number };
    positiveValueRange: { min: number; max: number };
    payloadBytes: number;
  };
  for (const status of ['missing', 'suppressed', 'zero', 'positive'] as const) {
    emit({ metric: `${status}_cells`, value: stats.counts[status] });
  }
  emit({ metric: 'lattice_cells', value: stats.counts.lattice });
  emit({ metric: 'source_rows_in_bounds', value: stats.counts.sourceRowsInBounds });
  emit({ metric: 'positive_value_max', value: stats.positiveValueRange.max });
  emit({ metric: 'payload_bytes', value: stats.payloadBytes });
  emit({ metric: 'first_frame_ms', value: renderer.firstFrameMs });

  const body = document.body.innerText;
  const plainBody = body.replaceAll('`', '');
  const sourceLink = [...document.querySelectorAll('a')].some((anchor) => anchor.href === 'https://www.e-stat.go.jp/help/data-definition-information/downloaddata/T001142.pdf');
  emit({ check: 'four-states-and-data-meaning-visible', pass: ['正の公表値', '公表されたゼロ', '秘匿', '行なし', 'レコードなし', '秘匿対象'].every((text) => body.includes(text)) && body.includes('*'),
    detail: 'Legend and official note distinguish positive value, exact zero, suppression and absent source row.' });
  emit({ check: 'estat-source-credit-and-license', pass: body.includes('令和2年国勢調査') && body.includes('総務省統計局') && body.includes('CC BY 4.0') && sourceLink,
    detail: 'The e-Stat census source, Statistics Bureau attribution, license and source link are visible.' });
  const suppressionLink = [...document.querySelectorAll('a')].some((anchor) => anchor.href === 'https://www.stat.go.jp/data/mesh/pdf/ryuijikou.pdf');
  emit({ check: 'official-null-and-suppression-semantics-linked', pass: suppressionLink && plainBody.includes('人口がないメッシュはレコードなし') && plainBody.includes('秘匿対象は*で表章'),
    detail: 'Official Statistics Bureau notes back the meanings of absent rows and asterisk suppression.' });
  emit({ check: 'study-area-and-metric-visible', pass: body.includes('250 m') && body.includes('75歳以上女性') && body.includes('139.65–139.78°E') && body.includes('35.62–35.72°N'),
    detail: 'Year, spatial resolution, metric and exact fixed bounds are stated.' });
  emit({ check: 'lattice-state-counts-match-baked-data', pass: stats.counts.lattice === 2016 && stats.counts.positive === 1716 && stats.counts.zero === 27 && stats.counts.suppressed === 49 && stats.counts.missing === 224,
    detail: `lattice=${stats.counts.lattice}; positive=${stats.counts.positive}; zero=${stats.counts.zero}; suppressed=${stats.counts.suppressed}; missing=${stats.counts.missing}` });

  const representatives = new Map<CellStatus, NullCell>();
  for (const cell of renderer.data.cells) if (!representatives.has(cell.status)) representatives.set(cell.status, cell);
  const allStatusesPresent = ['missing', 'suppressed', 'zero', 'positive'].every((status) => representatives.has(status as CellStatus));
  const colors = [...representatives.values()].map((cell) => renderer.colorFor(cell));
  emit({ check: 'each-null-state-has-distinct-drawing-treatment', pass: allStatusesPresent && new Set(colors).size === 4,
    detail: `four representative fill styles: ${colors.join(' / ')}` });
  const valuesValid = renderer.data.cells.every((cell) => cell.status === 'positive'
    ? Number.isInteger(cell.value) && cell.value! > 0
    : cell.value === null);
  emit({ check: 'suppressed-zero-and-missing-not-coerced', pass: valuesValid,
    detail: 'Only positive published values have numeric payloads; zero, asterisk and no-row remain separate states.' });

  const samples = [...representatives].map(([status, cell]) => ({ status, pixel: sample(renderer, cell) }));
  emit({ check: 'real-census-cells-render-to-canvas', pass: samples.every(({ pixel }) => !!pixel && pixel[3] === 255),
    detail: samples.map(({ status, pixel }) => `${status}=${pixel?.slice(0, 3).join(',') ?? 'offscreen'}`).join('; ') });

  const rect = renderer.canvas.getBoundingClientRect();
  const target = renderer.data.cells.find((cell) => {
    if (cell.status !== 'suppressed') return false;
    const point = renderer.canvasPoint(cell.code);
    return !!point && document.elementFromPoint(rect.left + point.x, rect.top + point.y) === renderer.canvas;
  }) ?? representatives.get('suppressed')!;
  const point = renderer.canvasPoint(target.code)!;
  renderer.canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + point.x, clientY: rect.top + point.y, bubbles: true }));
  const selectionPass = renderer.view.selectedCode === target.code;
  emit({ check: 'cell-selection-reports-suppression', pass: selectionPass,
    detail: `selected mesh ${renderer.view.selectedCode ?? 'none'}; expected suppressed ${target.code}` });
  const oldZoom = renderer.view.zoom;
  document.getElementById('zoom-in')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const zoomPass = renderer.view.zoom > oldZoom;
  emit({ check: 'zoom-controls-update-map', pass: zoomPass,
    detail: `zoom ${oldZoom} → ${renderer.view.zoom}` });
  emit({ check: 'cell-selection-and-zoom', pass: selectionPass && zoomPass,
    detail: `suppressed selection ${selectionPass}; zoom control ${zoomPass}` });
  renderer.resetView();

  const external = performance.getEntriesByType('resource').map((entry) => entry.name)
    .filter((name) => new URL(name, location.href).origin !== location.origin);
  emit({ check: 'no-runtime-external-map-services', pass: external.length === 0,
    detail: `off-origin resources: ${external.length}` });

  const drawSamples: number[] = [], frameTimestamps: number[] = [];
  for (let i = 0; i < 49; i++) {
    await new Promise<void>((resolve) => requestAnimationFrame((timestamp) => {
      frameTimestamps.push(timestamp);
      if (i < 48) {
        const drawStart = performance.now(); renderer.draw();
        drawSamples.push(performance.now() - drawStart);
      }
      resolve();
    }));
  }
  const frameSamples = frameIntervals(frameTimestamps);
  emit({ metric: 'frame_ms', values: frameSamples });
  emit({ metric: 'draw_cpu_ms', values: drawSamples });
  emit({ info: { renderer: 'Dedicated Canvas 2D quarter-mesh renderer', dataSource: 'e-Stat 2020 Population Census / T001142', metric: 'Female population aged 75 and over', nullStates: 'missing row / suppressed / exact zero / positive' } });
  emit({ done: true });
}
