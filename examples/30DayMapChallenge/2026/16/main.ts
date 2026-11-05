import { CollaborationRenderer, MonthTimeline, drawTimelineMonthLabel, updateSelectionText } from './renderer.ts';
import type { CollaborationCell, CollaborationBounds, EditCounts, CollaborationMap } from './collaboration.ts';

interface BakedPayload {
  schemaVersion: number;
  bounds: CollaborationBounds;
  gridSize: number;
  cells: CollaborationCell[];
  monthlyTotals: EditCounts[];
}
interface BakeStats {
  inputFeatureCount: number;
  mappedFeatureCount: number;
  unmappedNoGeometry: number;
  cellCount: number;
  payloadBytes: number;
}

const mapCanvas = document.getElementById('map') as HTMLCanvasElement;
const timelineCanvas = document.getElementById('timeline') as HTMLCanvasElement;
const statusElement = document.getElementById('status')!;
const countsElement = document.getElementById('counts')!;
const selectedElement = document.getElementById('selected')!;
const monthInput = document.getElementById('month') as HTMLInputElement;
const monthLabel = document.getElementById('month-label')!;
const MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
const base = '../../../../data/baked/30DayMapChallenge-2026-16';

try {
  const [payloadResponse, statsResponse] = await Promise.all([
    fetch(`${base}/collaboration.json`), fetch(`${base}/stats.json`),
  ]);
  if (!payloadResponse.ok || !statsResponse.ok) throw new Error('Baked map data is unavailable');
  const payload = await payloadResponse.json() as BakedPayload;
  const stats = await statsResponse.json() as BakeStats;
  if (payload.schemaVersion !== 1 || payload.monthlyTotals.length !== 12 || payload.cells.length !== stats.cellCount) {
    throw new Error('Invalid baked map data');
  }
  const data: CollaborationMap = {
    ...payload,
    inputFeatures: stats.inputFeatureCount,
    mappedFeatures: stats.mappedFeatureCount,
    unmappedNoGeometry: stats.unmappedNoGeometry,
    unmappedOutsideYear: 0,
    unmappedOutsideBounds: 0,
    cumulativeTotal(month: number): number {
      if (!Number.isInteger(month) || month < 0 || month > 11) throw new RangeError('Month must be 0..11');
      return payload.monthlyTotals.slice(0, month + 1).reduce((sum, current) => sum + current.total, 0);
    },
  };
  const renderer = new CollaborationRenderer(mapCanvas, data);
  const timeline = new MonthTimeline(timelineCanvas, data, (month) => setMonth(month));
  const selectedMonth = (): number => Number(monthInput.value);

  function setMonth(month: number): void {
    const value = Math.max(0, Math.min(11, Math.trunc(month)));
    monthInput.value = String(value);
    monthInput.setAttribute('aria-valuenow', String(value + 1));
    renderer.setMonth(value);
    drawTimelineMonthLabel(monthLabel, value);
    timeline.draw(value);
    const monthTotal = data.monthlyTotals[value]!.total;
    countsElement.textContent = `累積 ${data.cumulativeTotal(value)} 件 · ${MONTH_LABELS[value]}の記録 ${monthTotal} 件`;
    updateSelectionText(selectedElement, renderer);
  }

  monthInput.addEventListener('input', () => setMonth(selectedMonth()));
  document.getElementById('previous')!.addEventListener('click', () => setMonth(selectedMonth() - 1));
  document.getElementById('next')!.addEventListener('click', () => setMonth(selectedMonth() + 1));
  timelineCanvas.addEventListener('pointerdown', (event) => {
    const bounds = timelineCanvas.getBoundingClientRect();
    timeline.selectAtPixel(event.clientX - bounds.left);
  });
  mapCanvas.addEventListener('pointerdown', (event) => {
    const bounds = mapCanvas.getBoundingClientRect();
    renderer.selectPixel(event.clientX - bounds.left, event.clientY - bounds.top);
    updateSelectionText(selectedElement, renderer);
  });
  mapCanvas.addEventListener('keydown', (event) => {
    const delta = ({ ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] } as Record<string, [number, number]>)[event.key];
    if (!delta) return;
    event.preventDefault(); renderer.moveSelection(delta[0], delta[1]); updateSelectionText(selectedElement, renderer);
  });
  const resizeObserver = new ResizeObserver(() => { renderer.resize(); timeline.draw(selectedMonth()); });
  resizeObserver.observe(mapCanvas);
  setMonth(0);
  statusElement.textContent = `${stats.mappedFeatureCount} 件の編集位置 · ${stats.cellCount} セル · ${stats.unmappedNoGeometry} 件の位置情報なし`;
  const promptResponse = await fetch('./PROMPT.md');
  if (promptResponse.ok) document.getElementById('prompt')!.textContent = await promptResponse.text();
  if (new URLSearchParams(location.search).has('bench')) {
    const { run } = await import('./bench.ts'); await run(renderer, timeline, data, stats);
  }
} catch (error) {
  statusElement.textContent = `読み込みエラー: ${String(error)}`;
  console.error(error);
}
