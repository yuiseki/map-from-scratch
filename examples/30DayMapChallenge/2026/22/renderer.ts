import { project, projectSegment, PROJECTION_NAMES, screenPoint, type Point, type ProjectionName } from './projections.ts';

export interface Country { adm0_a3: string; name: string; geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: unknown } }
export interface CountryData { source: string; features: Country[] }
export interface Viewport { width: number; height: number; scale: number }

function coordinatePairs(input: unknown): Point[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item): item is number[] => Array.isArray(item) && item.length >= 2
    && typeof item[0] === 'number' && typeof item[1] === 'number').map((item) => [item[0]!, item[1]!]);
}

function geometryPolygons(country: Country): Point[][][] {
  const polygons = country.geometry.type === 'Polygon'
    ? [country.geometry.coordinates] : country.geometry.coordinates as unknown[];
  return polygons.map((polygon) => (polygon as unknown[]).map(coordinatePairs).filter((ring) => ring.length >= 3));
}

function hash(value: string): number {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
}

function emitMetric(metric: string, value: number) {
  window.__mfsEmit?.(JSON.stringify({ metric, value }));
}

export class ProjectionMap {
  readonly context: CanvasRenderingContext2D;
  readonly data: CountryData;
  readonly canvas: HTMLCanvasElement;
  projection: ProjectionName = 'Equal Earth';
  firstFrameMs = 0;
  drawCpuMs = 0;
  private start = performance.now();
  private dpr = 1;
  private resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, data: CountryData) {
    this.canvas = canvas;
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.context = context;
    this.data = data;
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas);
    this.draw();
    this.firstFrameMs = performance.now() - this.start;
    emitMetric('first_frame_ms', this.firstFrameMs);
  }

  get viewport(): Viewport {
    const width = this.canvas.clientWidth;
    const height = this.canvas.clientHeight;
    // One shared radians-to-pixels scale keeps the same reference parallel comparable across projections.
    const scale = Math.max(1, Math.min((width - 88) / (Math.PI * 2), (height - 164) / (Math.PI * 2)));
    return { width, height, scale };
  }

  setProjection(name: ProjectionName) {
    if (!PROJECTION_NAMES.includes(name)) throw new Error(`Unknown projection: ${name}`);
    this.projection = name;
    this.draw();
  }

  projectToScreen(point: Point): Point | null {
    const p = project(this.projection, point[0], point[1]);
    return p ? screenPoint(p, this.viewport) : null;
  }

  draw() {
    const t0 = performance.now();
    const { canvas, context: ctx } = this;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = this.viewport;
    ctx.fillStyle = '#081b24';
    ctx.fillRect(0, 0, width, height);
    const atmosphere = ctx.createRadialGradient(width * 0.5, height * 0.46, 8, width * 0.5, height * 0.46, Math.max(width, height) * 0.7);
    atmosphere.addColorStop(0, '#163948');
    atmosphere.addColorStop(1, '#081b24');
    ctx.fillStyle = atmosphere;
    ctx.fillRect(0, 0, width, height);
    this.drawGraticule(view);
    this.drawCountries(view);
    this.drawScale(view);
    this.drawCpuMs = performance.now() - t0;
  }

  private drawLine(coords: readonly Point[], view: Viewport, close = false) {
    const { context: ctx } = this;
    const parts = projectSegment(this.projection, coords);
    for (const part of parts) {
      const points = part.map((p) => screenPoint(p, view)).filter((p): p is Point => p !== null);
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0]![0], points[0]![1]);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]![0], points[i]![1]);
      if (close) ctx.closePath();
      if (close) ctx.fill('evenodd'); else ctx.stroke();
    }
  }

  private drawGraticule(view: Viewport) {
    const { context: ctx } = this;
    ctx.lineWidth = 0.7;
    ctx.strokeStyle = 'rgba(157, 192, 196, .22)';
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const line: Point[] = [];
      for (let longitude = -180; longitude <= 180; longitude += 3) line.push([longitude, latitude]);
      this.drawLine(line, view);
    }
    for (let longitude = -150; longitude <= 180; longitude += 30) {
      const line: Point[] = [];
      for (let latitude = -90; latitude <= 90; latitude += 3) line.push([longitude, latitude]);
      this.drawLine(line, view);
    }
    ctx.strokeStyle = 'rgba(242, 176, 92, .9)';
    ctx.lineWidth = 1.4;
    const equator: Point[] = [];
    for (let longitude = -180; longitude <= 180; longitude += 2) equator.push([longitude, 0]);
    this.drawLine(equator, view);
  }

  private drawCountries(view: Viewport) {
    const { context: ctx } = this;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(0.65, view.width / 1800);
    for (const country of this.data.features) {
      const hue = 177 + hash(country.adm0_a3) % 45;
      ctx.fillStyle = `hsl(${hue} 32% ${27 + hash(country.name) % 8}%)`;
      ctx.strokeStyle = 'rgba(212, 232, 222, .58)';
      for (const polygon of geometryPolygons(country)) {
        ctx.beginPath();
        for (const ring of polygon) {
          for (const part of projectSegment(this.projection, ring)) {
            const points = part.map((p) => screenPoint(p, view)).filter((p): p is Point => p !== null);
            if (points.length < 3) continue;
            ctx.moveTo(points[0]![0], points[0]![1]);
            for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]![0], points[i]![1]);
            ctx.closePath();
          }
        }
        // A single even-odd fill per polygon keeps interior rings as holes.
        ctx.fill('evenodd');
        ctx.stroke();
      }
    }
  }

  private drawScale(view: Viewport) {
    const { context: ctx } = this;
    const x = 32, y = view.height - 42;
    const p0 = this.projectToScreen([0, 0]);
    const p10 = this.projectToScreen([10, 0]);
    const width = p0 && p10 ? Math.abs(p10[0] - p0[0]) : 0;
    ctx.strokeStyle = '#f2b05c';
    ctx.fillStyle = '#d7e3df';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + width, y); ctx.stroke();
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText('10° at equator', x, y - 9);
    ctx.fillStyle = 'rgba(215, 227, 223, .76)';
    ctx.fillText('Equal Earth: equal area · Mercator: conformal, polar clipping ±85.0511° · graticule 30°', x, view.height - 16);
  }

  getPixel(x: number, y: number): [number, number, number, number] {
    const pixel = this.context.getImageData(Math.round(x * this.dpr), Math.round(y * this.dpr), 1, 1).data;
    return [pixel[0]!, pixel[1]!, pixel[2]!, pixel[3]!];
  }

  dispose() { this.resizeObserver.disconnect(); }
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<ProjectionMap> {
  const response = await fetch(dataUrl);
  if (!response.ok) throw new Error(`Country data request failed: ${response.status}`);
  const data = await response.json() as CountryData;
  if (data.features.length !== 177) throw new Error(`Expected 177 Natural Earth countries, got ${data.features.length}`);
  return new ProjectionMap(canvas, data);
}
