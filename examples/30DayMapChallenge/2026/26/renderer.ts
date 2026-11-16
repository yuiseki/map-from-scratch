import { depthLabel, featureAt, projectLocal, validateFloodMap, wheelZoomFactor, type FloodFeature, type FloodMap, type Position } from './flood.ts';

export const DEPTH_COLORS: Record<number, string> = {
  1: '#f4d35e', 2: '#f4a340', 3: '#f07845', 4: '#dc4d50', 5: '#bd3e70', 6: '#7b398c',
};
export const UNKNOWN_COLOR = '#83959a';
const RASTER_SIZE = 2048;
const BACKGROUND = '#17282f';

export interface CameraState { zoom: number; panX: number; panY: number }

export class FloodRenderer {
  readonly data: FloodMap;
  readonly canvas: HTMLCanvasElement;
  readonly state: CameraState = { zoom: 1, panX: 0, panY: 0 };
  readonly firstFrameMs: number;
  private readonly context: CanvasRenderingContext2D;
  private readonly raster: HTMLCanvasElement;
  private readonly onInspect: (feature: FloodFeature | null, point?: Position | null) => void;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private readonly mapAspect: number;
  private drag: { id: number; startX: number; startY: number; panX: number; panY: number; moved: boolean } | null = null;
  private hover: Position | null = null;
  private resizeObserver: ResizeObserver;

  private constructor(canvas: HTMLCanvasElement, data: FloodMap, startTime: number, onInspect: (feature: FloodFeature | null, point?: Position | null) => void) {
    const context = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.canvas = canvas;
    this.data = data;
    this.onInspect = onInspect;
    const [west, south, east, north] = data.bounds;
    const centerLat = (south + north) / 2;
    const widthMeters = (east - west) * 111_320 * Math.cos(centerLat * Math.PI / 180);
    const heightMeters = (north - south) * 111_132;
    this.mapAspect = widthMeters / heightMeters;
    this.raster = document.createElement('canvas');
    this.raster.width = Math.max(1, Math.round(RASTER_SIZE * this.mapAspect));
    this.raster.height = RASTER_SIZE;
    this.buildRaster();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.bindInput();
    this.resize();
    this.draw();
    this.firstFrameMs = performance.now() - startTime;
  }

  static async mount(canvas: HTMLCanvasElement, dataUrl: string, onInspect: (feature: FloodFeature | null, point?: Position | null) => void): Promise<FloodRenderer> {
    const startTime = performance.now();
    const response = await fetch(dataUrl, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`Flood data request failed: ${response.status}`);
    const data = await response.json() as FloodMap;
    validateFloodMap(data);
    return new FloodRenderer(canvas, data, startTime, onInspect);
  }

  private buildRaster(): void {
    const ctx = this.raster.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Offscreen raster context is unavailable');
    const sizeX = this.raster.width, sizeY = this.raster.height;
    const [west, south, east, north] = this.data.bounds;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, sizeX, sizeY);
    ctx.strokeStyle = 'rgba(154, 184, 188, 0.16)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 6; i++) {
      const x = (i / 6) * sizeX, y = (i / 6) * sizeY;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, sizeY); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(sizeX, y); ctx.stroke();
    }
    const features = [...this.data.features].sort((a, b) => (a.depthClass ?? 0) - (b.depthClass ?? 0));
    for (const feature of features) {
      const fill = feature.depthClass === null ? UNKNOWN_COLOR : DEPTH_COLORS[feature.depthClass]!;
      for (const polygon of feature.polygons) {
        const path = new Path2D();
        for (const ring of polygon) {
          for (let i = 0; i < ring.length; i++) {
            const [lon, lat] = ring[i]!;
            const x = ((lon - west) / (east - west)) * sizeX;
            const y = ((north - lat) / (north - south)) * sizeY;
            if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
          }
          path.closePath();
        }
        ctx.fillStyle = fill;
        ctx.fill(path, 'evenodd');
      }
    }
    ctx.strokeStyle = 'rgba(255, 244, 219, 0.22)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, sizeX - 2, sizeY - 2);
    ctx.font = '24px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(225, 239, 233, .62)';
    ctx.fillText(`${west.toFixed(2)}°E`, 12, sizeY - 15);
    ctx.textAlign = 'right'; ctx.fillText(`${east.toFixed(2)}°E`, sizeX - 12, sizeY - 15); ctx.textAlign = 'left';
    ctx.fillText(`${north.toFixed(2)}°N`, 12, 30);
    ctx.textAlign = 'right'; ctx.fillText(`${south.toFixed(2)}°N`, sizeX - 12, sizeY - 43); ctx.textAlign = 'left';
  }

  private resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.round(rect.width * this.dpr));
    const height = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width; this.canvas.height = height;
    }
    this.width = rect.width;
    this.height = rect.height;
    this.context.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  private mapBox() {
    let base: number, centerX: number, centerY: number;
    if (this.width <= 700) {
      const panelHeight = document.querySelector<HTMLElement>('.panel')?.getBoundingClientRect().height ?? 300;
      const freeHeight = Math.max(120, this.height - panelHeight - 190);
      base = Math.max(120, Math.min(freeHeight, (this.width - 24) / this.mapAspect));
      centerX = this.width / 2;
      centerY = panelHeight + freeHeight / 2;
    } else {
      const panelWidth = (document.querySelector<HTMLElement>('.panel')?.getBoundingClientRect().width ?? 354) + 38;
      const mapWidth = Math.max(120, this.width - panelWidth - 24);
      base = Math.max(120, Math.min(this.height - 32, mapWidth / this.mapAspect));
      centerX = panelWidth + mapWidth / 2;
      centerY = this.height / 2;
    }
    const height = base * this.state.zoom;
    const width = height * this.mapAspect;
    const left = centerX + this.state.panX - width / 2;
    const top = centerY + this.state.panY - height / 2;
    return { left, top, width, height, base };
  }

  draw(): void {
    const ctx = this.context;
    const { left, top, width, height } = this.mapBox();
    ctx.fillStyle = '#101c22'; ctx.fillRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.raster, left, top, width, height);
    ctx.strokeStyle = 'rgba(228, 242, 232, .55)'; ctx.lineWidth = 1;
    ctx.strokeRect(left, top, width, height);
    this.drawScale(ctx, left, top, width, height);
    const coordinates = this.hover ? `JGD2011 · ${this.hover[1].toFixed(5)}°N  ${this.hover[0].toFixed(5)}°E` : 'JGD2011 · move pointer over the map for coordinates';
    const label = document.getElementById('coordinates');
    if (label) label.textContent = coordinates;
  }

  private drawScale(ctx: CanvasRenderingContext2D, left: number, top: number, width: number, height: number): void {
    const [west, south, east, north] = this.data.bounds;
    const origin = projectLocal([west, (south + north) / 2], this.data.origin);
    const far = projectLocal([east, (south + north) / 2], this.data.origin);
    const widthMeters = far[0] - origin[0];
    const scalePixels = (500 / widthMeters) * width;
    const x = Math.max(14, Math.min(this.width - scalePixels - 14, left + 20));
    const y = Math.max(24, Math.min(this.height - 60, top + height - 32));
    ctx.strokeStyle = '#f2e9cf'; ctx.fillStyle = '#f2e9cf'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + scalePixels, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5); ctx.moveTo(x + scalePixels, y - 5); ctx.lineTo(x + scalePixels, y + 5); ctx.stroke();
    ctx.font = '12px system-ui, sans-serif'; ctx.fillText('500 m', x, y - 8);
  }

  private localPosition(clientX: number, clientY: number): Position | null {
    const rect = this.canvas.getBoundingClientRect();
    const px = clientX - rect.left, py = clientY - rect.top;
    const { left, top, width, height } = this.mapBox();
    const u = (px - left) / width, v = (py - top) / height;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    const [west, south, east, north] = this.data.bounds;
    return [west + u * (east - west), north - v * (north - south)];
  }

  pickAt(point: Position | null): FloodFeature | null {
    if (!point) return null;
    return featureAt(this.data.features, point);
  }

  screenPositionFor(point: Position): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const { left, top, width, height } = this.mapBox();
    const [west, south, east, north] = this.data.bounds;
    return [rect.left + left + ((point[0] - west) / (east - west)) * width,
      rect.top + top + ((north - point[1]) / (north - south)) * height];
  }

  inspectAt(point: Position | null): FloodFeature | null {
    const feature = this.pickAt(point);
    this.onInspect(feature, point);
    return feature;
  }

  resetView(): void { this.state.zoom = 1; this.state.panX = 0; this.state.panY = 0; this.draw(); }
  zoomBy(factor: number): void { this.state.zoom = Math.min(3, Math.max(.75, this.state.zoom * factor)); this.draw(); }

  private bindInput(): void {
    this.canvas.addEventListener('pointerdown', (event) => {
      if (event.isTrusted) this.canvas.setPointerCapture(event.pointerId);
      this.drag = { id: event.pointerId, startX: event.clientX, startY: event.clientY, panX: this.state.panX, panY: this.state.panY, moved: false };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      const point = this.localPosition(event.clientX, event.clientY);
      this.hover = point;
      if (this.drag && this.drag.id === event.pointerId) {
        const dx = event.clientX - this.drag.startX, dy = event.clientY - this.drag.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
        this.state.panX = this.drag.panX + dx;
        this.state.panY = this.drag.panY + dy;
      }
      this.draw();
    });
    const finish = (event: PointerEvent) => {
      if (!this.drag || this.drag.id !== event.pointerId) return;
      const wasDrag = this.drag.moved; this.drag = null;
      if (!wasDrag) this.inspectAt(this.localPosition(event.clientX, event.clientY));
      this.draw();
    };
    this.canvas.addEventListener('pointerup', finish);
    this.canvas.addEventListener('pointercancel', () => { this.drag = null; });
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const x = event.clientX - rect.left, y = event.clientY - rect.top;
      const oldBox = this.mapBox();
      const anchorU = (x - oldBox.left) / oldBox.width;
      const anchorV = (y - oldBox.top) / oldBox.height;
      const onMap = anchorU >= 0 && anchorU <= 1 && anchorV >= 0 && anchorV <= 1;
      const priorZoom = this.state.zoom;
      this.state.zoom = Math.min(3, Math.max(.75, priorZoom * wheelZoomFactor(event.deltaY, event.deltaMode, 16, this.canvas.clientHeight)));
      if (onMap) {
        const nextBox = this.mapBox();
        this.state.panX += x - (nextBox.left + anchorU * nextBox.width);
        this.state.panY += y - (nextBox.top + anchorV * nextBox.height);
      }
      this.draw();
    }, { passive: false });
  }
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string, onInspect: (feature: FloodFeature | null, point?: Position | null) => void): Promise<FloodRenderer> {
  return FloodRenderer.mount(canvas, dataUrl, onInspect);
}

export { depthLabel };
