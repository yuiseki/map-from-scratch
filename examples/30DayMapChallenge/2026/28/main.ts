import { GREEN_CLASS_CODES, WORLD_COVER_CLASSES, type CellInspection, type Position } from './feeling.ts';
import { mount, type GreenRenderer } from './renderer.ts';

declare global { interface Window { __mfsEmit?: (payload: string) => void } }
const required = <T extends Element>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing page element: ${selector}`);
  return element;
};
const canvas = required<HTMLCanvasElement>('#map');
const status = required<HTMLElement>('#status');
const selection = required<HTMLElement>('#selection');
const coordinates = required<HTMLElement>('#coordinates');
const scale = required<HTMLElement>('#scale');
const classNames: Record<number, string> = {
  10: '樹木', 20: '低木', 30: '草地', 40: '農地', 50: '市街地', 60: '裸地・疎生植生',
  70: '雪氷', 80: '水域', 90: '草本湿地', 95: 'マングローブ', 100: '苔・地衣類',
};

function showCell(cell: CellInspection | null): void {
  selection.replaceChildren();
  const heading = document.createElement('h2');
  const description = document.createElement('p');
  if (!cell) {
    heading.textContent = 'セルを選択';
    description.textContent = '100個の10 mピクセルの構成を調べられます。';
    selection.append(heading, description);
    return;
  }
  heading.textContent = `WorldCover セル · row ${cell.sourceRow} / col ${cell.sourceCol}`;
  description.textContent = cell.greenShare === null
    ? '緑被率: NoData（有効ピクセルなし）'
    : `緑被率: ${(cell.greenShare * 100).toFixed(1)}% · ${cell.greenPixels} / ${cell.validPixels} 有効ピクセル`;
  const counts = document.createElement('div');
  counts.className = 'counts';
  for (const code of WORLD_COVER_CLASSES) {
    const row = document.createElement('span'); row.className = 'count';
    const name = document.createElement('span'); name.textContent = `${code} ${classNames[code]}`;
    const value = document.createElement('b'); value.textContent = String(cell.counts[code]);
    row.append(name, value); counts.append(row);
  }
  selection.append(heading, description, counts);
}

function formatCoordinates(point: Position | null): string {
  return point ? `${point[1].toFixed(5)}°N · ${point[0].toFixed(5)}°E` : '—';
}

async function start(): Promise<void> {
  try {
    const started = performance.now();
    const dataUrl = '../../../../data/baked/30DayMapChallenge-2026-28/cells.json';
    const renderer: GreenRenderer = await mount(canvas, dataUrl, started, showCell, (point) => {
      coordinates.textContent = `座標 · ${formatCoordinates(point)}`;
    });
    const totalPixels = renderer.data.cells.reduce((sum, cell) => sum + cell[0]!, 0);
    const greenPixels = renderer.data.cells.reduce((sum, cell) => sum + GREEN_CLASS_CODES.reduce((part, code) => part + cell[WORLD_COVER_CLASSES.indexOf(code) + 2]!, 0), 0);
    const nodataCells = renderer.data.cells.filter((cell) => cell[0] === 0).length;
    status.textContent = `${renderer.data.cells.length.toLocaleString('ja-JP')}セル · 緑被率 ${(greenPixels / totalPixels * 100).toFixed(1)}% · NoData ${nodataCells}セル`;
    const updateScale = () => { scale.textContent = `画面内の縮尺 · 約${renderer.scaleMeters().toLocaleString('ja-JP')} m`; };
    const resize = () => { renderer.resize(); updateScale(); };
    new ResizeObserver(resize).observe(document.documentElement);
    window.addEventListener('resize', resize);
    required<HTMLButtonElement>('#zoom-in').addEventListener('click', () => { renderer.zoomBy(1.3); updateScale(); });
    required<HTMLButtonElement>('#zoom-out').addEventListener('click', () => { renderer.zoomBy(1 / 1.3); updateScale(); });
    required<HTMLButtonElement>('#reset').addEventListener('click', () => { renderer.resetView(); updateScale(); });
    canvas.addEventListener('wheel', updateScale, { passive: true });
    canvas.addEventListener('pointerup', updateScale);
    updateScale();

    const bench = new URLSearchParams(location.search).has('bench') ? await import('./bench.ts') : null;
    if (bench) await bench.run(renderer);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    status.dataset.error = 'true';
    console.error(error);
    if (new URLSearchParams(location.search).has('bench')) {
      window.__mfsEmit?.(JSON.stringify({ error: status.textContent }));
      window.__mfsEmit?.(JSON.stringify({ done: true }));
    }
  }
}

void start();
