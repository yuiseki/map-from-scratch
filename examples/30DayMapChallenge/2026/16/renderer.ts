import { cellCountsThrough, type CollaborationCell, type CollaborationMap, type EditCounts } from './collaboration.ts';

export interface MapRect { x: number; y: number; width: number; height: number }
export interface SelectedCell { x: number; y: number }
const COLORS = { creation: '#67d6b5', geometryChange: '#65bdff', tagChange: '#ffb86b', deletion: '#ff7395', other: '#d49cff' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function mapRect(width: number, height: number, data: CollaborationMap): MapRect {
  const bounds = data.bounds;
  const latitude = (bounds.north + bounds.south) / 2;
  const groundWidth = (bounds.east - bounds.west) * 111_320 * Math.cos(latitude * Math.PI / 180);
  const groundHeight = (bounds.north - bounds.south) * 111_320;
  const aspect = groundWidth / groundHeight;
  const compact = width < 720;
  const mapWidth = compact
    ? Math.min(width * 0.92, height * 0.37 * aspect)
    : Math.min(width * 0.46, (height - 120) * aspect, 740 * aspect);
  const mapHeight = mapWidth / aspect;
  return {
    x: width * (compact ? 0.5 : 0.68) - mapWidth / 2,
    y: height * (compact ? 0.72 : 0.5) - mapHeight / 2,
    width: mapWidth,
    height: mapHeight,
  };
}

export function cellAtPixel(
  pixelX: number,
  pixelY: number,
  rect: MapRect,
  gridSize: number,
): SelectedCell | null {
  if (pixelX < rect.x || pixelX >= rect.x + rect.width || pixelY < rect.y || pixelY >= rect.y + rect.height) return null;
  return {
    x: Math.floor((pixelX - rect.x) / rect.width * gridSize),
    y: Math.floor((pixelY - rect.y) / rect.height * gridSize),
  };
}

export function countsForSelection(data: CollaborationMap, selection: SelectedCell | null, month: number): EditCounts | null {
  if (!selection) return null;
  const cell = data.cells.find((item) => item.x === selection.x && item.y === selection.y);
  return cell ? cellCountsThrough(cell, month) : { total: 0, creation: 0, geometryChange: 0, tagChange: 0, deletion: 0, other: 0 };
}

export class CollaborationRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
  readonly data: CollaborationMap;
  readonly view = { month: 0, selected: null as SelectedCell | null };
  rect: MapRect = { x: 0, y: 0, width: 1, height: 1 };
  firstFrameMs = 0;
  drawCount = 0;

  constructor(canvas: HTMLCanvasElement, data: CollaborationMap) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.data = data;
    this.resize();
  }

  resize(): void {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, this.canvas.clientWidth), height = Math.max(1, this.canvas.clientHeight);
    if (this.canvas.width !== Math.round(width * ratio) || this.canvas.height !== Math.round(height * ratio)) {
      this.canvas.width = Math.round(width * ratio); this.canvas.height = Math.round(height * ratio);
    }
    this.context.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.rect = mapRect(width, height, this.data);
    this.draw();
  }

  setMonth(month: number): void {
    if (!Number.isInteger(month) || month < 0 || month > 11) throw new RangeError('Month must be 0..11');
    this.view.month = month; this.draw();
  }

  selectPixel(x: number, y: number): SelectedCell | null {
    const selection = cellAtPixel(x, y, this.rect, this.data.gridSize);
    this.view.selected = selection;
    this.draw();
    return selection;
  }

  moveSelection(dx: number, dy: number): SelectedCell {
    const current = this.view.selected ?? { x: Math.floor(this.data.gridSize / 2), y: Math.floor(this.data.gridSize / 2) };
    this.view.selected = {
      x: Math.max(0, Math.min(this.data.gridSize - 1, current.x + dx)),
      y: Math.max(0, Math.min(this.data.gridSize - 1, current.y + dy)),
    };
    this.draw();
    return this.view.selected;
  }

  selectedCounts(): EditCounts | null { return countsForSelection(this.data, this.view.selected, this.view.month); }

  draw(): void {
    const start = performance.now();
    const { context: ctx, canvas, rect, data } = this;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    ctx.fillStyle = '#0b1419'; ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#122127'; ctx.fillRect(rect.x - 14, rect.y - 14, rect.width + 28, rect.height + 28);
    ctx.strokeStyle = '#52676b'; ctx.lineWidth = 1; ctx.strokeRect(rect.x - 14.5, rect.y - 14.5, rect.width + 29, rect.height + 29);
    ctx.fillStyle = '#15272d'; ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    const cellW = rect.width / data.gridSize, cellH = rect.height / data.gridSize;
    const cumulative = data.cells.map((cell) => ({ cell, counts: cellCountsThrough(cell, this.view.month) }));
    const peak = Math.max(1, ...cumulative.map((item) => item.counts.total));
    for (const { cell, counts } of cumulative) {
      const x = rect.x + cell.x * cellW, y = rect.y + cell.y * cellH;
      const intensity = Math.sqrt(counts.total / peak);
      ctx.fillStyle = counts.total ? heatColor(intensity) : '#172a30';
      ctx.globalAlpha = counts.total ? 0.28 + intensity * 0.72 : 0.78;
      ctx.fillRect(x + 0.7, y + 0.7, Math.max(0, cellW - 1.4), Math.max(0, cellH - 1.4));
      if (counts.total >= 4 && cellW >= 20) {
        ctx.globalAlpha = 0.9; ctx.fillStyle = '#182129'; ctx.font = `600 ${Math.min(14, cellH * 0.38)}px ui-monospace, monospace`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(counts.total), x + cellW / 2, y + cellH / 2);
      }
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#31474d'; ctx.lineWidth = 0.7;
    for (let i = 0; i <= data.gridSize; i++) {
      const x = rect.x + i * cellW, y = rect.y + i * cellH;
      ctx.beginPath(); ctx.moveTo(x, rect.y); ctx.lineTo(x, rect.y + rect.height); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rect.x, y); ctx.lineTo(rect.x + rect.width, y); ctx.stroke();
    }
    this.drawAxes();
    this.drawScaleBar();
    this.drawNorthArrow();
    this.drawSelectedCell();
    this.drawHeader();
    this.drawStats(cumulative.reduce((sum, item) => sum + item.counts.total, 0));
    if (!this.firstFrameMs) this.firstFrameMs = performance.now() - start;
    this.drawCount++;
  }

  private drawAxes(): void {
    const { context: ctx, rect, data } = this;
    ctx.fillStyle = '#8aa4a8'; ctx.font = '10px ui-monospace, monospace'; ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
    for (let tick = 0; tick <= 4; tick++) {
      const lon = data.bounds.west + (data.bounds.east - data.bounds.west) * tick / 4;
      const x = rect.x + rect.width * tick / 4;
      ctx.fillText(`${lon.toFixed(3)}°E`, x, rect.y + rect.height + 17);
    }
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let tick = 0; tick <= 4; tick++) {
      const lat = data.bounds.north - (data.bounds.north - data.bounds.south) * tick / 4;
      const y = rect.y + rect.height * tick / 4;
      ctx.fillText(`${lat.toFixed(3)}°N`, rect.x - 9, y);
    }
  }

  private drawScaleBar(): void {
    const { context: ctx, rect, data } = this;
    const latitude = (data.bounds.north + data.bounds.south) / 2;
    const totalMeters = (data.bounds.east - data.bounds.west) * 111_320 * Math.cos(latitude * Math.PI / 180);
    const barWidth = rect.width * 200 / totalMeters;
    const x = rect.x + 10, y = rect.y + rect.height - 10;
    ctx.fillStyle = '#e2e9dc'; ctx.fillRect(x, y, barWidth, 2);
    ctx.fillRect(x, y - 4, 1, 10); ctx.fillRect(x + barWidth - 1, y - 4, 1, 10);
    ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('200 m', x, y - 6);
  }

  private drawNorthArrow(): void {
    const { context: ctx, rect } = this;
    const x = rect.x + rect.width - 20, y = rect.y + 25;
    ctx.strokeStyle = '#dce7df'; ctx.fillStyle = '#dce7df'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y + 18); ctx.lineTo(x, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 3); ctx.lineTo(x - 4, y + 5); ctx.lineTo(x + 4, y + 5); ctx.closePath(); ctx.fill();
    ctx.font = '10px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText('N', x, y - 5);
  }

  private drawSelectedCell(): void {
    const selected = this.view.selected;
    if (!selected) return;
    const { context: ctx, rect, data } = this;
    const cellW = rect.width / data.gridSize, cellH = rect.height / data.gridSize;
    const x = rect.x + selected.x * cellW, y = rect.y + selected.y * cellH;
    ctx.strokeStyle = '#fff3bc'; ctx.lineWidth = 2.5; ctx.strokeRect(x + 1, y + 1, cellW - 2, cellH - 2);
  }

  private drawHeader(): void {
    const { context: ctx, rect } = this;
    ctx.fillStyle = '#f5c77d'; ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText('SHIBUYA · COLLABORATIVE RECORD', rect.x, rect.y - 23);
  }

  private drawStats(total: number): void {
    const { context: ctx, rect } = this;
    const text = `2025 · THROUGH ${MONTHS[this.view.month]?.toUpperCase()} · ${total} LOCATED EDITS`;
    ctx.fillStyle = '#d0ddd9'; ctx.font = '11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(text, rect.x, rect.y + rect.height + 33);
  }
}

export class MonthTimeline {
  private readonly context: CanvasRenderingContext2D;
  readonly canvas: HTMLCanvasElement;
  readonly data: CollaborationMap;
  private readonly onSelect: (month: number) => void;
  constructor(canvas: HTMLCanvasElement, data: CollaborationMap, onSelect: (month: number) => void) {
    this.canvas = canvas; this.data = data; this.onSelect = onSelect;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Timeline Canvas 2D is unavailable');
    this.context = context;
  }

  draw(activeMonth: number): void {
    const { canvas, context: ctx, data } = this;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.clearRect(0, 0, width, height);
    const left = 7, top = 4, bottom = height - 15, chartW = width - left * 2, chartH = bottom - top;
    const peak = Math.max(1, ...data.monthlyTotals.map((item) => item.total));
    const gap = 3, barW = (chartW - gap * 11) / 12;
    for (let month = 0; month < 12; month++) {
      const total = data.monthlyTotals[month]!.total;
      const barH = total / peak * chartH;
      const x = left + month * (barW + gap), y = bottom - barH;
      ctx.fillStyle = month === activeMonth ? '#ffd06f' : total ? '#dd7957' : '#31434a';
      ctx.fillRect(x, y, barW, Math.max(2, barH));
      ctx.fillStyle = month === activeMonth ? '#fff0bd' : '#83999c';
      ctx.font = '9px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillText(MONTHS[month]!, x + barW / 2, bottom + 3);
    }
  }

  monthAtPixel(pixelX: number): number {
    const width = this.canvas.clientWidth, left = 7, chartW = width - left * 2;
    return Math.max(0, Math.min(11, Math.floor((pixelX - left) / chartW * 12)));
  }

  selectAtPixel(pixelX: number): void { this.onSelect(this.monthAtPixel(pixelX)); }
}

export function updateSelectionText(element: HTMLElement, renderer: CollaborationRenderer): void {
  const selected = renderer.view.selected;
  if (!selected) { element.textContent = 'セルを選ぶと、そこに集まった編集種別が表示されます。'; return; }
  const counts = renderer.selectedCounts()!;
  element.textContent = `格子 ${selected.x + 1}, ${selected.y + 1} · 累積 ${counts.total} 件 · 新規 ${counts.creation} · 形状 ${counts.geometryChange} · 属性 ${counts.tagChange} · その他 ${counts.other}`;
}

export function updateKindLegend(element: HTMLElement): void {
  element.innerHTML = Object.entries(COLORS).map(([kind, color]) => `<span><i style="background:${color}"></i>${kindLabel(kind)}</span>`).join('');
}

export function drawTimelineMonthLabel(element: HTMLElement, month: number): void {
  element.textContent = `2025年 ${month + 1}月までの累積`;
}

function heatColor(value: number): string {
  const low = [43, 108, 110], high = [255, 190, 105];
  const t = Math.max(0, Math.min(1, value));
  return `rgb(${Math.round(low[0]! + (high[0]! - low[0]!) * t)},${Math.round(low[1]! + (high[1]! - low[1]!) * t)},${Math.round(low[2]! + (high[2]! - low[2]!) * t)})`;
}

function kindLabel(kind: string): string {
  return ({ creation: '新規', geometryChange: '形状', tagChange: '属性', deletion: '削除', other: '未分類' } as Record<string, string>)[kind] ?? kind;
}
