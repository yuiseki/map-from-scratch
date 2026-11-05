import { buildIllustrativePlume, decodeSmellData, windTowardVector, type Position, type SmellData } from './smell.ts';

const METERS_PER_DEGREE = 111_320;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export class SmellRenderer {
  readonly data: SmellData;
  readonly canvas: HTMLCanvasElement;
  readonly firstFrameMs: number;
  private readonly ctx: CanvasRenderingContext2D;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private zoom = 1;
  private panX = 0;
  private panY = 0;
  private drag: { x: number; y: number; panX: number; panY: number } | null = null;
  private baseScale = 0;
  private readonly centerLon: number;
  private readonly centerLat: number;
  private readonly metersPerLonDegree: number;

  constructor(canvas: HTMLCanvasElement, data: SmellData) {
    this.canvas = canvas;
    this.data = decodeSmellData(data);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D is unavailable');
    this.ctx = ctx;
    this.centerLon = (data.bounds.west + data.bounds.east) / 2;
    this.centerLat = (data.bounds.south + data.bounds.north) / 2;
    this.metersPerLonDegree = METERS_PER_DEGREE * Math.cos(this.centerLat * Math.PI / 180);
    const start = performance.now();
    this.resize();
    this.draw();
    this.firstFrameMs = performance.now() - start;
    const observer = new ResizeObserver(() => { this.resize(); this.draw(); });
    observer.observe(canvas);
    this.attachInput();
  }

  private resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.baseScale = Math.min(
      Math.max(1, this.width - 80) / ((this.data.bounds.east - this.data.bounds.west) * this.metersPerLonDegree),
      Math.max(1, this.height - 100) / ((this.data.bounds.north - this.data.bounds.south) * METERS_PER_DEGREE),
    );
  }

  private attachInput() {
    this.canvas.addEventListener('pointerdown', (event) => {
      try { this.canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic test pointers have no browser capture target. */ }
      this.drag = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
    });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.drag) return;
      this.panX = this.drag.panX + event.clientX - this.drag.x;
      this.panY = this.drag.panY + event.clientY - this.drag.y;
      this.draw();
    });
    const stop = () => { this.drag = null; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top);
    }, { passive: false });
    this.canvas.addEventListener('keydown', (event) => {
      const step = 32;
      if (event.key === 'ArrowLeft') this.panX += step;
      else if (event.key === 'ArrowRight') this.panX -= step;
      else if (event.key === 'ArrowUp') this.panY += step;
      else if (event.key === 'ArrowDown') this.panY -= step;
      else if (event.key === '+' || event.key === '=') this.setZoom(this.zoom * 1.2);
      else if (event.key === '-') this.setZoom(this.zoom / 1.2);
      else return;
      event.preventDefault();
      this.draw();
    });
  }

  private zoomAt(factor: number, x = this.width / 2, y = this.height / 2) {
    const oldZoom = this.zoom;
    this.zoom = clamp(this.zoom * factor, 0.65, 4);
    const ratio = this.zoom / oldZoom;
    this.panX = x - (x - this.panX) * ratio;
    this.panY = y - (y - this.panY) * ratio;
    this.draw();
  }

  setZoom(value: number) { this.zoomAt(value / this.zoom); }

  resetView() { this.zoom = 1; this.panX = 0; this.panY = 0; this.draw(); }

  screenPoint([lon, lat]: Position) {
    const scale = this.baseScale * this.zoom;
    return {
      x: this.width / 2 + this.panX + (lon - this.centerLon) * this.metersPerLonDegree * scale,
      y: this.height / 2 + this.panY - (lat - this.centerLat) * METERS_PER_DEGREE * scale,
    };
  }

  getSourcePoint() { return this.screenPoint([this.data.sources[0]!.lon, this.data.sources[0]!.lat]); }

  get sourceScreen() { return this.getSourcePoint(); }
  get zoomLevel() { return this.zoom; }

  getPlumePoint(distanceM: number, lateralFraction = 0) {
    const source = this.data.sources[0]!;
    const towardBearing = (this.data.observation.fromDegrees + 180) % 360;
    const target = windTowardVector(this.data.observation.fromDegrees, distanceM);
    const side = lateralFraction * (this.data.plume.sourceHalfWidthM + this.data.plume.spreadRatio * distanceM);
    const theta = towardBearing * Math.PI / 180;
    const east = target.east - Math.cos(theta) * side;
    const north = target.north + Math.sin(theta) * side;
    return this.screenPoint([source.lon + east / this.metersPerLonDegree, source.lat + north / METERS_PER_DEGREE]);
  }

  private localToScreen(east: number, north: number) {
    const source = this.data.sources[0]!;
    return this.screenPoint([source.lon + east / this.metersPerLonDegree, source.lat + north / METERS_PER_DEGREE]);
  }

  private drawLines(lines: Position[][], color: string, width: number) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const line of lines) {
      if (line.length < 2) continue;
      const first = this.screenPoint(line[0]!);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < line.length; i++) {
        const point = this.screenPoint(line[i]!);
        ctx.lineTo(point.x, point.y);
      }
    }
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  private drawPlume() {
    const source = this.data.sources[0]!;
    const direction = (this.data.observation.fromDegrees + 180) % 360;
    const origin = { east: 0, north: 0 };
    const polygon = buildIllustrativePlume(origin, direction, this.data.plume.lengthM,
      this.data.plume.spreadRatio, this.data.plume.sourceHalfWidthM);
    const points = polygon.map((point) => this.localToScreen(point.east, point.north));
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i]!.x, points[i]!.y);
    ctx.closePath();
    const endVector = windTowardVector(this.data.observation.fromDegrees, this.data.plume.lengthM);
    const end = this.localToScreen(endVector.east, endVector.north);
    const gradient = ctx.createLinearGradient(points[0]!.x, points[0]!.y, end.x, end.y);
    gradient.addColorStop(0, 'rgba(229, 135, 75, .27)');
    gradient.addColorStop(1, 'rgba(229, 135, 75, .08)');
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.strokeStyle = 'rgba(177, 89, 47, .7)';
    ctx.lineWidth = 1.4;
    ctx.stroke();

    const axisEnd = windTowardVector(this.data.observation.fromDegrees, this.data.plume.lengthM);
    const axis = this.localToScreen(axisEnd.east, axisEnd.north);
    ctx.beginPath();
    ctx.setLineDash([7, 6]);
    ctx.moveTo(points[0]!.x, points[0]!.y);
    ctx.lineTo(axis.x, axis.y);
    ctx.strokeStyle = 'rgba(157, 72, 39, .82)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);
    const labelX = (points[2]!.x + points[3]!.x) / 2;
    const labelY = (points[2]!.y + points[3]!.y) / 2;
    ctx.fillStyle = '#9c4b2b';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('仮定した風下域 · 5 km', labelX, labelY - 10);
    void source;
  }

  private drawFacility() {
    const ctx = this.ctx;
    const source = this.data.sources[0]!;
    for (const ring of source.outline) {
      if (ring.length < 3) continue;
      ctx.beginPath();
      const first = this.screenPoint(ring[0]!);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < ring.length; i++) {
        const point = this.screenPoint(ring[i]!);
        ctx.lineTo(point.x, point.y);
      }
      ctx.closePath();
      ctx.fillStyle = '#f6c86f';
      ctx.fill();
      ctx.strokeStyle = '#744321';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const point = this.getSourcePoint();
    ctx.beginPath();
    ctx.arc(point.x, point.y, 5.5, 0, Math.PI * 2);
    ctx.fillStyle = '#77441f';
    ctx.fill();
    ctx.strokeStyle = '#fff8e9';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(255,255,255,.93)';
    ctx.strokeText('芝浦水再生センター', point.x + 10, point.y - 8);
    ctx.fillStyle = '#573619';
    ctx.fillText('芝浦水再生センター', point.x + 10, point.y - 8);
  }

  private drawWindStation() {
    const ctx = this.ctx;
    const wind = this.data.observation;
    const station = this.screenPoint([wind.stationLon, wind.stationLat]);
    const vector = windTowardVector(wind.fromDegrees, 1_700);
    const tip = this.localToScreen(
      (wind.stationLon - this.data.sources[0]!.lon) * this.metersPerLonDegree + vector.east,
      (wind.stationLat - this.data.sources[0]!.lat) * METERS_PER_DEGREE + vector.north,
    );
    ctx.beginPath();
    ctx.moveTo(station.x, station.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.strokeStyle = '#235a76';
    ctx.lineWidth = 2.6;
    ctx.stroke();
    const angle = Math.atan2(tip.y - station.y, tip.x - station.x);
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - 10 * Math.cos(angle - .45), tip.y - 10 * Math.sin(angle - .45));
    ctx.lineTo(tip.x - 10 * Math.cos(angle + .45), tip.y - 10 * Math.sin(angle + .45));
    ctx.closePath();
    ctx.fillStyle = '#235a76';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(station.x, station.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#f7fbfc';
    ctx.fill();
    ctx.strokeStyle = '#235a76';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.textAlign = 'left';
    ctx.font = '650 12px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.94)';
    ctx.strokeText('JMA 東京 · 観測所', station.x + 12, station.y + 20);
    ctx.fillStyle = '#19465d';
    ctx.fillText('JMA 東京 · 観測所', station.x + 12, station.y + 20);
  }

  private drawScaleAndNorth() {
    const ctx = this.ctx;
    const lengthM = 2000;
    const px = lengthM * this.baseScale * this.zoom;
    const x = 28, y = this.height - 30;
    ctx.strokeStyle = '#263a40';
    ctx.fillStyle = '#263a40';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x + px, y);
    ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
    ctx.moveTo(x + px, y - 5); ctx.lineTo(x + px, y + 5);
    ctx.stroke();
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('2 km', x, y - 8);
    ctx.textAlign = 'right';
    ctx.font = '700 15px system-ui, sans-serif';
    ctx.fillText('N', this.width - 26, 34);
    ctx.beginPath();
    ctx.moveTo(this.width - 30, 42); ctx.lineTo(this.width - 30, 64);
    ctx.moveTo(this.width - 30, 42); ctx.lineTo(this.width - 35, 50);
    ctx.moveTo(this.width - 30, 42); ctx.lineTo(this.width - 25, 50);
    ctx.stroke();
  }

  draw() {
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#eaf0ed';
    ctx.fillRect(0, 0, this.width, this.height);
    const { bounds } = this.data;
    ctx.strokeStyle = 'rgba(62,94,96,.11)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const lonStep = 0.025, latStep = 0.02;
    for (let lon = Math.ceil(bounds.west / lonStep) * lonStep; lon <= bounds.east; lon += lonStep) {
      const a = this.screenPoint([lon, bounds.south]), b = this.screenPoint([lon, bounds.north]);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    for (let lat = Math.ceil(bounds.south / latStep) * latStep; lat <= bounds.north; lat += latStep) {
      const a = this.screenPoint([bounds.west, lat]), b = this.screenPoint([bounds.east, lat]);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    this.drawLines(this.data.waterways, 'rgba(68,153,176,.46)', 1.45);
    this.drawLines(this.data.roads, 'rgba(70,84,85,.20)', 0.7);
    this.drawPlume();
    this.drawFacility();
    this.drawWindStation();
    this.drawScaleAndNorth();
  }
}

export async function mount(canvas: HTMLCanvasElement, base: string): Promise<SmellRenderer> {
  const response = await fetch(`${base}/smell.json`);
  if (!response.ok) throw new Error(`smell.json: HTTP ${response.status}`);
  const data: unknown = await response.json();
  return new SmellRenderer(canvas, decodeSmellData(data));
}
