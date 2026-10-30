interface Station {
  name: string;
  pos: [number, number];
}

interface LuxembourgData {
  boundary: [number, number][];
  rails: [number, number][][];
  stations: Station[];
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export class LuxembourgRailMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  data: LuxembourgData = { boundary: [], rails: [], stations: [] };
  center = { lon: 6.13, lat: 49.80 };
  zoom = 10;
  dpr = 1;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private onRender?: () => void;

  constructor(canvas: HTMLCanvasElement, onRender?: () => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.onRender = onRender;

    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  async load(baseDir = '../../..'): Promise<void> {
    const res = await fetch(`${baseDir}/data/baked/forge3d-004-luxembourg-rail-network/luxembourg.json`);
    this.data = (await res.json()) as LuxembourgData;
    this.fitBoundary();
    this.draw();
  }

  // Open on the whole country: a fixed zoom 10 is taller than an 800 px window.
  // The baked boundary is already in Web Mercator units (0..1).
  private fitBoundary(): void {
    const xs = this.data.boundary.map(([x]) => x);
    const ys = this.data.boundary.map(([, y]) => y);
    if (!xs.length) return;
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = this.canvas.width / this.dpr, h = this.canvas.height / this.dpr;
    const fit = Math.min((w * 0.9) / (maxX - minX), (h * 0.9) / (maxY - minY)) / 256;
    this.zoom = Math.max(7, Math.min(15, Math.log2(fit)));
    const cy = (0.5 - (minY + maxY) / 2) * 2 * Math.PI;
    this.center = { lon: ((minX + maxX) / 2) * 360 - 180, lat: (2 * Math.atan(Math.exp(cy)) - Math.PI / 2) * (180 / Math.PI) };
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
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

  private setupInteractions(): void {
    this.canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.dragStart.x;
      const dy = e.clientY - this.dragStart.y;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.panBy(dx, dy);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.002;
      this.setZoom(Math.max(7, Math.min(15, this.zoom + zoomDelta)));
    }, { passive: false });
  }

  getScreenCoords(mx: number, my: number): { x: number; y: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    return {
      x: w / 2 + (mx - centerMx) * scale,
      y: h / 2 + (my - centerMy) * scale,
    };
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Deep slate background
    ctx.fillStyle = '#141a22';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    // 1. Draw Luxembourg territory polygon
    if (this.data.boundary.length > 0) {
      ctx.beginPath();
      for (let i = 0; i < this.data.boundary.length; i++) {
        const [mx, my] = this.data.boundary[i];
        const sx = w / 2 + (mx - centerMx) * scale;
        const sy = h / 2 + (my - centerMy) * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fillStyle = '#222c38';
      ctx.fill();
      ctx.strokeStyle = '#48586c';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // 2. Draw Rail lines (Glow + Core)
    // Glow pass
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(255, 87, 34, 0.35)';
    ctx.lineWidth = 7;
    for (const line of this.data.rails) {
      ctx.beginPath();
      for (let i = 0; i < line.length; i++) {
        const [mx, my] = line[i];
        const sx = w / 2 + (mx - centerMx) * scale;
        const sy = h / 2 + (my - centerMy) * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // Core pass
    ctx.strokeStyle = '#ff6e40';
    ctx.lineWidth = 2.8;
    for (const line of this.data.rails) {
      ctx.beginPath();
      for (let i = 0; i < line.length; i++) {
        const [mx, my] = line[i];
        const sx = w / 2 + (mx - centerMx) * scale;
        const sy = h / 2 + (my - centerMy) * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.stroke();
    }

    // 3. Draw Station nodes
    for (const station of this.data.stations) {
      const pos = this.getScreenCoords(station.pos[0], station.pos[1]);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffab91';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = '#bf360c';
      ctx.fill();
    }

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
