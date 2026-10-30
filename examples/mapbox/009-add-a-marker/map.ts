type Polygon = [number, number][][];
export interface Marker {
  lon: number;
  lat: number;
  color: string;
  rotation: number;
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export class MarkerMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  markers: Marker[] = [];
  center = { lon: 12.550343, lat: 55.665957 };
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
    const [landRes, markerRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/mapbox-009-add-a-marker/land.json`),
      fetch(`${baseDir}/data/baked/mapbox-009-add-a-marker/markers.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.markers = (await markerRes.json()) as Marker[];
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
      this.setZoom(Math.max(1, Math.min(18, this.zoom + zoomDelta)));
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

    // Water background
    ctx.fillStyle = '#cad2d3';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    // Draw land polygons
    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#c0b8ac';
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

    // Draw markers
    for (const m of this.markers) {
      const pos = this.getScreenCoords(m.lon, m.lat);
      this.drawPin(ctx, pos.x, pos.y, m.color, m.rotation);
    }

    ctx.restore();
    if (this.onRender) this.onRender();
  }

  private drawPin(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, rotationDeg: number): void {
    ctx.save();
    ctx.translate(x, y);

    // Drop shadow
    ctx.save();
    ctx.scale(1, 0.4);
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
    ctx.fill();
    ctx.restore();

    if (rotationDeg !== 0) {
      ctx.rotate((rotationDeg * Math.PI) / 180);
    }

    // Pin shape with tip at (0, 0)
    ctx.beginPath();
    ctx.arc(0, -28, 12, Math.PI, 0, false);
    ctx.bezierCurveTo(12, -18, 5, -8, 0, 0);
    ctx.bezierCurveTo(-5, -8, -12, -18, -12, -28);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Inner white dot
    ctx.beginPath();
    ctx.arc(0, -28, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();

    ctx.restore();
  }
}
