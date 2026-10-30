type Polygon = [number, number][][];

export interface Billboard {
  name: string;
  lon: number;
  lat: number;
  color: string;
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export class BillboardMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  billboards: Billboard[] = [];
  center = { lon: 31.2357, lat: 30.0444 };
  zoom = 2;
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
    const [landRes, bbRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/openglobus-004-billboards/land.json`),
      fetch(`${baseDir}/data/baked/openglobus-004-billboards/billboards.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.billboards = (await bbRes.json()) as Billboard[];
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
      // Keep the point under the pointer still: move it to the centre, zoom,
      // then move it back to the pointer at the new scale.
      const r = this.canvas.getBoundingClientRect();
      const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
      this.panBy(-ox, -oy);
      this.setZoom(Math.max(1, Math.min(10, this.zoom + zoomDelta)));
      this.panBy(ox, oy);
    }, { passive: false });
  }

  getScreenCoords(lon: number, lat: number): { x: number; y: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);
    const mx = mercX(lon);
    const my = mercY(lat);

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

    // Deep slate ocean
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;

    // Wrap around (-1, 0, +1)
    const minWrap = Math.floor(centerMx - w / (2 * scale));
    const maxWrap = Math.ceil(centerMx + w / (2 * scale));

    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const offsetX = w / 2 + (wrap - centerMx) * scale;
      for (const poly of this.polygons) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const rx = offsetX + ring[i][0] * scale;
            const ry = h / 2 + (ring[i][1] - centerMy) * scale;
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    // Draw billboards
    for (const b of this.billboards) {
      const pos = this.getScreenCoords(b.lon, b.lat);
      this.drawBillboardBadge(ctx, pos.x, pos.y, b.color, b.name);
    }

    ctx.restore();
    if (this.onRender) this.onRender();
  }

  private drawBillboardBadge(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, name: string): void {
    ctx.save();
    ctx.translate(x, y);

    // Drop shadow
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 2;

    // Outer circle
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // Inner white dot
    ctx.beginPath();
    ctx.arc(0, 0, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    // Label with dark halo
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
    ctx.lineWidth = 3;
    ctx.strokeText(name, 0, -14);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(name, 0, -14);

    ctx.restore();
  }
}
