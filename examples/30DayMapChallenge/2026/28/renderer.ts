import { cellBounds, cellGreenShare, cellIndexAt, greenShareBand, GREEN_BAND_COLORS, NO_DATA_COLOR, pickCell, validateGreenMap, type CellInspection, type GreenMap, type Position } from './feeling.ts';

export interface CameraState { zoom: number; panX: number; panY: number }
export interface MapRect { left: number; top: number; width: number; height: number }

export class GreenRenderer {
  readonly data: GreenMap;
  readonly canvas: HTMLCanvasElement;
  readonly camera: CameraState = { zoom: 1, panX: 0, panY: 0 };
  readonly firstFrameMs: number;
  private readonly context: CanvasRenderingContext2D;
  private readonly raster: HTMLCanvasElement;
  private readonly onInspect: (cell: CellInspection | null) => void;
  private readonly onCoordinates: (position: Position | null) => void;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readonly mapAspect: number;
  private drag: { id: number; x: number; y: number; panX: number; panY: number; moved: boolean } | null = null;
  private activeCell: { row: number; col: number } | null = null;

  private constructor(canvas: HTMLCanvasElement, data: GreenMap, started: number, onInspect: (cell: CellInspection | null) => void, onCoordinates: (position: Position | null) => void) {
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.canvas = canvas;
    this.data = data;
    this.context = ctx;
    this.onInspect = onInspect;
    this.onCoordinates = onCoordinates;
    const centerLat = data.grid.north - (data.grid.firstRow + data.grid.rows / 2) * data.grid.step;
    this.mapAspect = data.grid.cols * Math.cos(centerLat * Math.PI / 180) * 111_320 / (data.grid.rows * 110_574);
    this.raster = document.createElement('canvas');
    this.raster.width = data.grid.cols;
    this.raster.height = data.grid.rows;
    const rasterCtx = this.raster.getContext('2d', { alpha: false });
    if (!rasterCtx) throw new Error('Offscreen raster context unavailable');
    const image = rasterCtx.createImageData(this.raster.width, this.raster.height);
    for (let i = 0; i < data.cells.length; i++) {
      const share = cellGreenShare(data.cells[i]!);
      const color = share === null ? NO_DATA_COLOR : GREEN_BAND_COLORS[greenShareBand(share)]!;
      const offset = i * 4;
      image.data[offset] = Number.parseInt(color.slice(1, 3), 16);
      image.data[offset + 1] = Number.parseInt(color.slice(3, 5), 16);
      image.data[offset + 2] = Number.parseInt(color.slice(5, 7), 16);
      image.data[offset + 3] = 255;
    }
    rasterCtx.putImageData(image, 0, 0);
    this.resize();
    this.bindInput();
    this.draw();
    this.firstFrameMs = performance.now() - started;
  }

  static async mount(canvas: HTMLCanvasElement, dataUrl: string, started: number,
    onInspect: (cell: CellInspection | null) => void,
    onCoordinates: (position: Position | null) => void): Promise<GreenRenderer> {
    const response = await fetch(dataUrl);
    if (!response.ok) throw new Error(`WorldCover bake load failed: HTTP ${response.status}`);
    const data = await response.json() as GreenMap;
    validateGreenMap(data);
    return new GreenRenderer(canvas, data, started, onInspect, onCoordinates);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  baseRect(): MapRect {
    const mobile = this.width < 820;
    const left = mobile ? 16 : Math.min(this.width * 0.32, 380);
    const right = mobile ? 16 : 24;
    const top = mobile ? Math.min(310, this.height * 0.38) : 20;
    const bottom = 20;
    const availableWidth = Math.max(1, this.width - left - right);
    const availableHeight = Math.max(1, this.height - top - bottom);
    const width = Math.min(availableWidth, availableHeight * this.mapAspect);
    const height = width / this.mapAspect;
    return { left: left + (availableWidth - width) / 2, top: top + (availableHeight - height) / 2, width, height };
  }

  mapRect(): MapRect {
    const base = this.baseRect();
    const width = base.width * this.camera.zoom, height = base.height * this.camera.zoom;
    return { left: base.left + (base.width - width) / 2 + this.camera.panX, top: base.top + (base.height - height) / 2 + this.camera.panY, width, height };
  }

  draw(): number {
    const started = performance.now();
    const ctx = this.context;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#102027';
    ctx.fillRect(0, 0, this.width, this.height);
    const rect = this.mapRect();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.raster, rect.left, rect.top, rect.width, rect.height);
    ctx.strokeStyle = '#d9e3d0';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(rect.left) + .5, Math.round(rect.top) + .5, Math.round(rect.width) - 1, Math.round(rect.height) - 1);
    if (this.activeCell) {
      const x = rect.left + this.activeCell.col * rect.width / this.data.grid.cols;
      const y = rect.top + this.activeCell.row * rect.height / this.data.grid.rows;
      ctx.strokeStyle = '#f7f0c1'; ctx.lineWidth = 2;
      ctx.strokeRect(x + .5, y + .5, Math.max(1, rect.width / this.data.grid.cols - 1), Math.max(1, rect.height / this.data.grid.rows - 1));
    }

    const scaleMeters = this.scaleMeters(rect.width);
    const mapWidthM = this.data.grid.cols * this.data.grid.step * 111_320 * Math.cos(this.centerLatitude() * Math.PI / 180);
    const scalePx = scaleMeters / mapWidthM * rect.width;
    const scaleX = rect.left + 18, scaleY = rect.top + rect.height - 18;
    ctx.fillStyle = '#102027d9'; ctx.fillRect(scaleX - 8, scaleY - 26, scalePx + 16, 38);
    ctx.strokeStyle = '#f4f1dc'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(scaleX, scaleY); ctx.lineTo(scaleX + scalePx, scaleY); ctx.stroke();
    ctx.fillStyle = '#f4f1dc'; ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'bottom'; ctx.fillText(`${scaleMeters} m`, scaleX, scaleY - 7);
    ctx.textBaseline = 'top'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.fillText('N ↑', rect.left + rect.width - 36, rect.top + 12);
    return performance.now() - started;
  }

  scaleMeters(rectWidth = this.mapRect().width): number {
    const mapWidthM = this.data.grid.cols * this.data.grid.step * 111_320 * Math.cos(this.centerLatitude() * Math.PI / 180) * this.camera.zoom;
    const visibleWidthM = mapWidthM * this.baseRect().width / rectWidth;
    const target = visibleWidthM * .22;
    const power = Math.floor(Math.log10(Math.max(1, target)));
    const unit = 10 ** power;
    const normal = target / unit;
    return (normal >= 5 ? 5 : normal >= 2 ? 2 : 1) * unit;
  }

  centerLatitude(): number {
    return this.data.grid.north - (this.data.grid.firstRow + this.data.grid.rows / 2) * this.data.grid.step;
  }

  screenPositionFor(position: Position): [number, number] {
    const rect = this.mapRect();
    const west = this.data.grid.west + this.data.grid.firstCol * this.data.grid.step;
    const north = this.data.grid.north - this.data.grid.firstRow * this.data.grid.step;
    return [rect.left + (position[0] - west) / (this.data.grid.cols * this.data.grid.step) * rect.width,
      rect.top + (north - position[1]) / (this.data.grid.rows * this.data.grid.step) * rect.height];
  }

  inspectAt(position: Position | null): CellInspection | null {
    const cell = position ? pickCell(this.data, position) : null;
    this.onInspect(cell);
    return cell;
  }

  resetView(): void { this.camera.zoom = 1; this.camera.panX = 0; this.camera.panY = 0; this.draw(); }
  zoomBy(factor: number): void { this.camera.zoom = Math.max(.75, Math.min(10, this.camera.zoom * factor)); this.draw(); }

  private positionAt(x: number, y: number): Position | null {
    const rect = this.mapRect();
    const u = (x - rect.left) / rect.width, v = (y - rect.top) / rect.height;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) return null;
    const col = this.data.grid.firstCol + u * this.data.grid.cols;
    const row = this.data.grid.firstRow + v * this.data.grid.rows;
    const b = cellBounds(this.data.grid, Math.floor(row), Math.floor(col));
    return [(b.west + b.east) / 2, (b.south + b.north) / 2];
  }

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.isTrusted) this.canvas.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, x: event.clientX, y: event.clientY, panX: this.camera.panX, panY: this.camera.panY, moved: false };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const point = this.positionAt(event.clientX - rect.left, event.clientY - rect.top);
      this.onCoordinates(point);
      if (this.drag && this.drag.id === event.pointerId) {
        const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        this.camera.panX = this.drag.panX + dx;
        this.camera.panY = this.drag.panY + dy;
      }
      this.draw();
    });
    const finish = (event: PointerEvent) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const wasDrag = this.drag.moved;
      this.drag = null;
      if (!wasDrag) {
        const rect = this.canvas.getBoundingClientRect();
        const position = this.positionAt(event.clientX - rect.left, event.clientY - rect.top);
        this.setActivePosition(position);
        this.inspectAt(position);
      }
      this.draw();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('keydown', (event) => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(event.key)) return;
      event.preventDefault();
      if (!this.activeCell) this.activeCell = { row: Math.floor(this.data.grid.rows / 2), col: Math.floor(this.data.grid.cols / 2) };
      if (event.key === 'ArrowUp') this.activeCell.row = Math.max(0, this.activeCell.row - 1);
      if (event.key === 'ArrowDown') this.activeCell.row = Math.min(this.data.grid.rows - 1, this.activeCell.row + 1);
      if (event.key === 'ArrowLeft') this.activeCell.col = Math.max(0, this.activeCell.col - 1);
      if (event.key === 'ArrowRight') this.activeCell.col = Math.min(this.data.grid.cols - 1, this.activeCell.col + 1);
      const bounds = cellBounds(this.data.grid, this.data.grid.firstRow + this.activeCell.row, this.data.grid.firstCol + this.activeCell.col);
      const center: Position = [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
      this.onCoordinates(center);
      this.inspectAt(center);
      this.draw();
    });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const before = this.mapRect();
      const u = (x - before.left) / before.width, v = (y - before.top) / before.height;
      const anchor = u >= 0 && u <= 1 && v >= 0 && v <= 1;
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.height : 1);
      const factor = Math.exp(-Math.max(-180, Math.min(180, delta)) * .0015);
      this.zoomBy(factor);
      if (anchor) {
        const after = this.mapRect();
        this.camera.panX += x - (after.left + u * after.width);
        this.camera.panY += y - (after.top + v * after.height);
      }
      this.draw();
    }, { passive: false });
  }

  private setActivePosition(position: Position | null): void {
    if (!position) { this.activeCell = null; return; }
    const index = cellIndexAt(this.data, position);
    this.activeCell = index ? { row: index.row, col: index.col } : null;
  }
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string, started: number,
  onInspect: (cell: CellInspection | null) => void,
  onCoordinates: (position: Position | null) => void): Promise<GreenRenderer> {
  return GreenRenderer.mount(canvas, dataUrl, started, onInspect, onCoordinates);
}
