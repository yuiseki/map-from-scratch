interface Station {
  name: string;
  pos: [number, number];
}

interface RailData {
  title: string;
  boundary: [number, number][];
  rails: [number, number][][];
  stations: Station[];
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const RAIL_COLOR = '#2563eb';
const STATION_COLOR = '#e11d48';

export class VectorExportMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  data: RailData = { title: '', boundary: [], rails: [], stations: [] };
  center = { lon: 6.13, lat: 49.8 };
  zoom = 10;
  dpr = 1;

  private dragging = false;
  private last = { x: 0, y: 0 };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const res = await fetch(`${baseDir}/data/baked/forge3d-008-vector-export/luxembourg.json`);
    this.data = (await res.json()) as RailData;
    this.fitBoundary();
    this.draw();
  }

  private fitBoundary(): void {
    const xs = this.data.boundary.map(([x]) => x);
    const ys = this.data.boundary.map(([, y]) => y);
    if (!xs.length) return;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const fit = Math.min((w * 0.9) / (maxX - minX), (h * 0.9) / (maxY - minY)) / 256;
    this.zoom = Math.max(7, Math.min(15, Math.log2(fit)));
    const cy = (0.5 - (minY + maxY) / 2) * 2 * Math.PI;
    this.center = {
      lon: ((minX + maxX) / 2) * 360 - 180,
      lat: (2 * Math.atan(Math.exp(cy)) - Math.PI / 2) * (180 / Math.PI),
    };
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  private viewport(): { w: number; h: number; originX: number; originY: number; scale: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    return {
      w,
      h,
      scale,
      originX: w / 2 - mercX(this.center.lon) * scale,
      originY: h / 2 - mercY(this.center.lat) * scale,
    };
  }

  panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon) - dx / scale;
    const centerMy = mercY(this.center.lat) - dy / scale;
    this.center.lon = centerMx * 360 - 180;
    const y2 = (0.5 - centerMy) * 2 * Math.PI;
    this.center.lat = (2 * Math.atan(Math.exp(y2)) - Math.PI / 2) * (180 / Math.PI);
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.draw();
  }

  setCenter(lon: number, lat: number): void {
    this.center = { lon, lat };
    this.draw();
  }

  screenPos(mx: number, my: number): [number, number] {
    const v = this.viewport();
    return [v.originX + mx * v.scale, v.originY + my * v.scale];
  }

  stationScreen(name: string): [number, number] | null {
    const s = this.data.stations.find((st) => st.name === name);
    return s ? this.screenPos(s.pos[0], s.pos[1]) : null;
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      this.panBy(dx, dy);
    });
    this.canvas.addEventListener('pointerup', (e) => {
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.setZoom(Math.max(7, Math.min(15, this.zoom + (e.deltaY < 0 ? 0.25 : -0.25))));
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const { w, h, scale, originX, originY } = this.viewport();
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = '#eef2f5';
    ctx.fillRect(0, 0, w, h);

    ctx.beginPath();
    this.tracePath(ctx, this.data.boundary, originX, originY, scale);
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.strokeStyle = RAIL_COLOR;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const rail of this.data.rails) {
      ctx.beginPath();
      this.tracePath(ctx, rail, originX, originY, scale);
      ctx.stroke();
    }

    ctx.fillStyle = STATION_COLOR;
    for (const s of this.data.stations) {
      const [x, y] = this.screenPos(s.pos[0], s.pos[1]);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  private tracePath(
    ctx: CanvasRenderingContext2D,
    pts: [number, number][],
    originX: number,
    originY: number,
    scale: number,
  ): void {
    for (let i = 0; i < pts.length; i++) {
      const x = originX + pts[i][0] * scale;
      const y = originY + pts[i][1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }

  // Serialise the current view to SVG with the same geometry and colours.
  exportSvg(): string {
    const v = this.viewport();
    const path = (pts: [number, number][]): string =>
      pts
        .map(([mx, my], i) => `${i === 0 ? 'M' : 'L'}${(v.originX + mx * v.scale).toFixed(2)} ${(v.originY + my * v.scale).toFixed(2)}`)
        .join(' ') + ' Z';
    const line = (pts: [number, number][]): string =>
      pts
        .map(([mx, my], i) => `${i === 0 ? 'M' : 'L'}${(v.originX + mx * v.scale).toFixed(2)} ${(v.originY + my * v.scale).toFixed(2)}`)
        .join(' ');
    const rails = this.data.rails
      .map((rail) => `    <path d="${line(rail)}" fill="none" stroke="${RAIL_COLOR}" stroke-width="2.5"/>`)
      .join('\n');
    const stations = this.data.stations
      .map((s) => {
        const [x, y] = this.screenPos(s.pos[0], s.pos[1]);
        return `    <circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="4" fill="${STATION_COLOR}"><title>${s.name}</title></circle>`;
      })
      .join('\n');
    return [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${v.w}" height="${v.h}" viewBox="0 0 ${v.w} ${v.h}">`,
      `  <title>${this.data.title}</title>`,
      `  <rect width="100%" height="100%" fill="#eef2f5"/>`,
      `  <path d="${path(this.data.boundary)}" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>`,
      rails,
      stations,
      `</svg>`,
    ].join('\n');
  }
}
