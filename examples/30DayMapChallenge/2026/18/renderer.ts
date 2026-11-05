import { enumerateMeshLattice, type CellStatus, type GeographicBounds, type NullCell } from './nullmap.ts';

export interface NullMap {
  title: string;
  bounds: GeographicBounds;
  year: number;
  meshMeters: number;
  metric: string;
  cells: NullCell[];
  legend: Record<CellStatus, string>;
  attribution: string;
  license: string;
}

const STATUS_LABEL: Record<CellStatus, string> = {
  missing: '行なし · 人口記録なし',
  suppressed: '* · 秘匿値',
  zero: '0人 · 公表されたゼロ',
  positive: '正の公表値',
};
const COLORS = {
  paper: '#e8e5da', ink: '#102027', muted: '#59666a', missing: '#18242b',
  suppressed: '#d98250', zero: '#f3df83', positiveLow: [31, 133, 144] as const,
  positiveHigh: [218, 243, 213] as const,
};

function validateData(data: NullMap): void {
  if (!data || !Array.isArray(data.cells) || !data.cells.length) throw new Error('Day 18 baked mesh grid is empty');
  const expected = enumerateMeshLattice(data.bounds);
  if (expected.length !== data.cells.length) throw new Error('Day 18 lattice cell count does not match the view bounds');
  const expectedCodes = new Set(expected.map((cell) => cell.code));
  const seen = new Set<string>();
  for (const cell of data.cells) {
    if (seen.has(cell.code)) throw new Error(`Day 18 has duplicate cell ${cell.code}`);
    if (!expectedCodes.has(cell.code)) throw new Error(`Day 18 has cell outside the view bounds ${cell.code}`);
    if (!['missing', 'suppressed', 'zero', 'positive'].includes(cell.status)) throw new Error(`Invalid cell status: ${cell.status}`);
    if (cell.status === 'positive' ? !Number.isInteger(cell.value) || cell.value! < 1 : cell.value !== null) {
      throw new Error(`Invalid value for ${cell.status} cell ${cell.code}`);
    }
    seen.add(cell.code);
  }
}

function mix(from: readonly number[], to: readonly number[], t: number): string {
  return `rgb(${from.map((v, i) => Math.round(v + (to[i]! - v) * t)).join(',')})`;
}

export type NullRenderer = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const started = performance.now();
  const [mapResponse, statsResponse] = await Promise.all([fetch(`${base}/null.json`), fetch(`${base}/stats.json`)]);
  if (!mapResponse.ok || !statsResponse.ok) throw new Error('Day 18 baked NULL data is missing');
  const [data, stats] = await Promise.all([mapResponse.json() as Promise<NullMap>, statsResponse.json()]);
  validateData(data);
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D unavailable');

  let width = 0, height = 0, dpr = 1, firstFrameMs = 0;
  let zoom = 1, panX = 0, panY = 0, dragging = false, didMove = false, lastPointer: { x: number; y: number } | null = null;
  let selected: NullCell | null = null;
  let cellsOnScreen: { cell: NullCell; x: number; y: number; width: number; height: number }[] = [];
  let projectedCells: { cell: NullCell; x: number; y: number; width: number; height: number; color: string }[] = [];
  let suppressedPattern: CanvasPattern | null = null;
  let mapRect = { x: 0, y: 0, width: 0, height: 0 }, baseScale = 1, originX = 0, originY = 0;
  const meanLat = (data.bounds.south + data.bounds.north) / 2;
  const lonScale = Math.cos(meanLat * Math.PI / 180);

  function layout() {
    const margin = width < 700 ? 12 : 28;
    mapRect = { x: margin, y: margin, width: width - margin * 2, height: height - margin * 2 };
    const groundWidth = (data.bounds.east - data.bounds.west) * lonScale;
    const groundHeight = data.bounds.north - data.bounds.south;
    baseScale = Math.min(mapRect.width / groundWidth, mapRect.height / groundHeight);
    originX = mapRect.x + (mapRect.width - groundWidth * baseScale) / 2;
    originY = mapRect.y + (mapRect.height - groundHeight * baseScale) / 2;
    projectedCells = data.cells.map((cell) => ({
      cell,
      x: originX + (cell.west - data.bounds.west) * lonScale * baseScale,
      y: originY + (data.bounds.north - cell.north) * baseScale,
      width: (cell.east - cell.west) * lonScale * baseScale,
      height: (cell.north - cell.south) * baseScale,
      color: cellColor(cell),
    }));
  }

  function project(longitude: number, latitude: number) {
    const baseX = originX + (longitude - data.bounds.west) * lonScale * baseScale;
    const baseY = originY + (data.bounds.north - latitude) * baseScale;
    const cx = mapRect.x + mapRect.width / 2, cy = mapRect.y + mapRect.height / 2;
    return { x: cx + (baseX - cx) * zoom + panX, y: cy + (baseY - cy) * zoom + panY };
  }

  function cellColor(cell: NullCell): string {
    if (cell.status === 'missing') return COLORS.missing;
    if (cell.status === 'suppressed') return COLORS.suppressed;
    if (cell.status === 'zero') return COLORS.zero;
    const positiveMax = stats.positiveValueRange.max as number;
    const scale = Math.log1p(cell.value!) / Math.log1p(positiveMax);
    return mix(COLORS.positiveLow, COLORS.positiveHigh, Math.sqrt(scale));
  }

  function draw() {
    if (!width || !height) return;
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx!.fillStyle = COLORS.ink; ctx!.fillRect(0, 0, width, height);
    ctx!.save(); ctx!.beginPath(); ctx!.rect(mapRect.x, mapRect.y, mapRect.width, mapRect.height); ctx!.clip();
    cellsOnScreen = [];
    const minSide = Math.max(1, baseScale * zoom * Math.min(0.125 / 60, 0.1875 / 60 * lonScale));
    const cx = mapRect.x + mapRect.width / 2, cy = mapRect.y + mapRect.height / 2;
    for (const projected of projectedCells) {
      const { cell } = projected;
      const x = Math.round(cx + (projected.x - cx) * zoom + panX);
      const y = Math.round(cy + (projected.y - cy) * zoom + panY);
      const right = Math.round(cx + (projected.x + projected.width - cx) * zoom + panX);
      const bottom = Math.round(cy + (projected.y + projected.height - cy) * zoom + panY);
      const w = Math.max(0, right - x), h = Math.max(0, bottom - y);
      if (x > mapRect.x + mapRect.width || right < mapRect.x || y > mapRect.y + mapRect.height || bottom < mapRect.y) continue;
      cellsOnScreen.push({ cell, x, y, width: w, height: h });
      ctx!.fillStyle = cell.status === 'suppressed' && suppressedPattern ? suppressedPattern : projected.color;
      ctx!.fillRect(x, y, w + 0.25, h + 0.25);
      if (cell.status === 'missing') {
        ctx!.strokeStyle = '#82919a'; ctx!.lineWidth = Math.max(0.55, Math.min(1.2, minSide / 16));
        ctx!.setLineDash([Math.max(1.2, minSide / 6), Math.max(1.1, minSide / 8)]);
        ctx!.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1)); ctx!.setLineDash([]);
      } else if (cell.status === 'suppressed') {
        // The repeated pattern distinguishes unknown values without drawing a
        // separate set of hatch strokes for every suppressed cell on each frame.
      } else if (cell.status === 'zero' && minSide >= 11) {
        ctx!.fillStyle = '#544c2b'; ctx!.font = `600 ${Math.max(8, Math.min(10, minSide * 0.5))}px ui-monospace,monospace`;
        ctx!.textAlign = 'center'; ctx!.textBaseline = 'middle'; ctx!.fillText('0', x + w / 2, y + h / 2);
      }
      ctx!.strokeStyle = cell.status === 'missing' ? '#364750' : '#0c1a20';
      ctx!.lineWidth = Math.max(0.35, Math.min(0.8, minSide / 24)); ctx!.strokeRect(x + 0.25, y + 0.25, Math.max(0, w - 0.5), Math.max(0, h - 0.5));
      if (selected?.code === cell.code) {
        ctx!.strokeStyle = '#fff3bd'; ctx!.lineWidth = 2.4; ctx!.setLineDash([]);
        ctx!.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
      }
    }
    ctx!.restore();
    if (!firstFrameMs) firstFrameMs = performance.now() - started;
  }

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr); layout(); draw();
  }
  function select(cell: NullCell | null) {
    selected = cell;
    canvas.dispatchEvent(new CustomEvent('null-cell-select', { detail: { cell } }));
    draw();
  }
  function cellAt(x: number, y: number): NullCell | null {
    for (let i = cellsOnScreen.length - 1; i >= 0; i--) {
      const item = cellsOnScreen[i]!;
      if (x >= item.x && x <= item.x + item.width && y >= item.y && y <= item.y + item.height) return item.cell;
    }
    return null;
  }
  function canvasPoint(code: string) {
    const cell = data.cells.find((candidate) => candidate.code === code);
    return cell ? project(cell.longitude, cell.latitude) : null;
  }
  function setZoom(value: number) { zoom = Math.min(12, Math.max(1, value)); draw(); }
  function resetView() { zoom = 1; panX = 0; panY = 0; select(null); }

  const tile = document.createElement('canvas'); tile.width = 8; tile.height = 8;
  const tileContext = tile.getContext('2d');
  if (tileContext) {
    tileContext.fillStyle = COLORS.suppressed; tileContext.fillRect(0, 0, 8, 8);
    tileContext.strokeStyle = '#4e2d27'; tileContext.lineWidth = 2;
    tileContext.beginPath(); tileContext.moveTo(-2, 8); tileContext.lineTo(8, -2); tileContext.stroke();
    tileContext.beginPath(); tileContext.moveTo(4, 10); tileContext.lineTo(10, 4); tileContext.stroke();
    suppressedPattern = ctx.createPattern(tile, 'repeat');
  }
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  canvas.addEventListener('pointerdown', (event) => {
    if (!event.isTrusted) return;
    dragging = true; didMove = false; lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture(event.pointerId); canvas.dataset.dragging = 'true';
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging || !lastPointer) return;
    const dx = event.clientX - lastPointer.x, dy = event.clientY - lastPointer.y;
    if (Math.hypot(dx, dy) > 1) didMove = true;
    panX += dx; panY += dy;
    lastPointer = { x: event.clientX, y: event.clientY }; draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    const moved = didMove;
    dragging = false; didMove = false; lastPointer = null; delete canvas.dataset.dragging;
    if (moved) return;
    const rect = canvas.getBoundingClientRect(); select(cellAt(event.clientX - rect.left, event.clientY - rect.top));
  });
  canvas.addEventListener('pointercancel', () => { dragging = false; lastPointer = null; delete canvas.dataset.dragging; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect(), anchorX = event.clientX - rect.left, anchorY = event.clientY - rect.top;
    const oldZoom = zoom; zoom = Math.min(12, Math.max(1, zoom * Math.exp(-event.deltaY * 0.001)));
    const ratio = zoom / oldZoom, cx = mapRect.x + mapRect.width / 2, cy = mapRect.y + mapRect.height / 2;
    panX = anchorX - cx - (anchorX - cx - panX) * ratio;
    panY = anchorY - cy - (anchorY - cy - panY) * ratio;
    draw();
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom = Math.min(12, zoom * 1.25); draw(); }
    else if (event.key === '-') { event.preventDefault(); zoom = Math.max(1, zoom / 1.25); draw(); }
    else if (event.key === 'Home') { event.preventDefault(); zoom = 1; panX = 0; panY = 0; select(null); }
    else if (event.key === 'Escape') { event.preventDefault(); select(null); }
  });
  resize();
  return {
    data, stats, canvas, draw, select,
    get firstFrameMs() { return firstFrameMs; },
    get view() { return { selectedCode: selected?.code ?? null, zoom, panX, panY }; },
    canvasPoint, setZoom, resetView,
    get mapRect() { return mapRect; },
    colorFor: cellColor,
    labelFor: (cell: NullCell) => STATUS_LABEL[cell.status],
  };
}
