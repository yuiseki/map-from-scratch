type Polygon = [number, number][][];

interface Line {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  v: number;
}

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

export class LineLayerMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  lines: Line[] = [];

  center = { lon: -96.0, lat: 38.5 };
  zoom = 3.4;
  dpr = 1;

  private pathPos = new Path2D();
  private pathNeg = new Path2D();
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
    const [landRes, lineRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/deckgl-014-line-layer/land.json`),
      fetch(`${baseDir}/data/baked/deckgl-014-line-layer/lines.bin`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.decodeLines(await lineRes.arrayBuffer());
    this.draw();
  }

  private decodeLines(buffer: ArrayBuffer): void {
    const dv = new DataView(buffer);
    const count = dv.getUint32(6, true);
    this.lines = new Array(count);
    this.pathPos = new Path2D();
    this.pathNeg = new Path2D();

    for (let i = 0; i < count; i++) {
      const o = 10 + i * 12;
      const sx = dv.getUint16(o, true) / 65535;
      const sy = dv.getUint16(o + 2, true) / 65535;
      const tx = dv.getUint16(o + 4, true) / 65535;
      const ty = dv.getUint16(o + 6, true) / 65535;
      const v = dv.getInt32(o + 8, true);
      this.lines[i] = { sx, sy, tx, ty, v };
      const path = v >= 0 ? this.pathPos : this.pathNeg;
      path.moveTo(sx, sy);
      path.lineTo(tx, ty);
    }
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
    this.zoom = Math.max(1, Math.min(8, zoom));
    this.draw();
  }

  zoomAtPoint(x: number, y: number, z: number): void {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    const mx = mercX(this.center.lon) + (x - w / 2) / scale;
    const my = mercY(this.center.lat) + (y - h / 2) / scale;
    this.zoom = Math.max(1, Math.min(8, z));
    const next = 256 * Math.pow(2, this.zoom);
    const centerMx = mx - (x - w / 2) / next;
    const centerMy = my - (y - h / 2) / next;
    this.center.lon = centerMx * 360 - 180;
    const y2 = (0.5 - centerMy) * 2 * Math.PI;
    this.center.lat = (2 * Math.atan(Math.exp(y2)) - Math.PI / 2) * (180 / Math.PI);
    this.draw();
  }

  screenOfWorld(mx: number, my: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    return [w / 2 + (mx - mercX(this.center.lon)) * scale, h / 2 + (my - mercY(this.center.lat)) * scale];
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
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
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, this.zoom + (e.deltaY < 0 ? 0.3 : -0.3));
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const originX = w / 2 - mercX(this.center.lon) * scale;
    const originY = h / 2 - mercY(this.center.lat) * scale;

    ctx.fillStyle = '#16233a';
    ctx.strokeStyle = '#2b3a55';
    ctx.lineWidth = 1;
    const minWrap = Math.floor(mercX(this.center.lon) - w / (2 * scale));
    const maxWrap = Math.ceil(mercX(this.center.lon) + w / (2 * scale));
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const shiftX = originX + wrap * scale;
      // Skip whole world copies that fall outside the canvas: at this zoom
      // only one copy intersects the viewport, and the extra copy paid the
      // rasterisation cost of every polygon for nothing.
      if (shiftX > w || shiftX + scale < 0) continue;
      for (const poly of this.polygons) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const x = shiftX + ring[i][0] * scale;
            const y = originY + ring[i][1] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    // Each pair of counties is one Path2D entry, split by migration direction.
    // Drawing a whole path per frame keeps per-line JS work out of the loop.
    // Westward (orange) is laid down first so the eastward cyan stays legible
    // where lines cross in the dense East Coast and Midwest clusters.
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.5 / scale;
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const ox = originX + wrap * scale;
      if (ox > w || ox + scale < 0) continue;
      ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * ox, this.dpr * originY);
      ctx.strokeStyle = 'rgba(245,158,11,0.85)';
      ctx.stroke(this.pathNeg);
      ctx.strokeStyle = 'rgba(56,189,248,0.85)';
      ctx.stroke(this.pathPos);
    }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    ctx.restore();
  }
}
