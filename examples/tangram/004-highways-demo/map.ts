type Polygon = [number, number][][];
type Line = [number, number][];

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export class TangramHighwaysMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  highways: Line[] = [];
  center = { lon: -122.4194, lat: 37.7749 };
  zoom = 8;
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
    const [landRes, hwRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/tangram-004-highways-demo/land.json`),
      fetch(`${baseDir}/data/baked/tangram-004-highways-demo/highways.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.highways = (await hwRes.json()) as Line[];
    this.draw();
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
      this.setZoom(Math.max(5, Math.min(14, this.zoom + zoomDelta)));
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

    // Tangram dark background
    ctx.fillStyle = '#151922';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    // 1. Draw Land Polygons
    ctx.fillStyle = '#1e2430';
    ctx.strokeStyle = '#2e3846';
    ctx.lineWidth = 1;

    for (const poly of this.polygons) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const rx = w / 2 + (ring[i][0] - centerMx) * scale;
          const ry = h / 2 + (ring[i][1] - centerMy) * scale;
          if (i === 0) ctx.moveTo(rx, ry);
          else ctx.lineTo(rx, ry);
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    // 2. Draw Highways (Zoom-dependent line width)
    // Scale line width exponentially with zoom (z6 -> ~1px, z8 -> ~2.2px, z10 -> ~4.5px)
    const coreWidth = Math.max(1.0, Math.pow(1.5, this.zoom - 6.0));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Glow pass
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = coreWidth * 2.8;
    for (const line of this.highways) {
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

    // Core neon pass
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = coreWidth;
    for (const line of this.highways) {
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

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
