type Polygon = [number, number][][];

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;

export class MaplibreHeatmapMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  points: Float32Array = new Float32Array(0); // [x, y, weight, ...]
  pointCount = 0;

  // Initial view: North Pacific / US West Coast / Alaska
  center = { lon: -130, lat: 45 };
  zoom = 2.5;
  dpr = 1;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private onRender?: () => void;
  private kernelCanvas: HTMLCanvasElement | null = null;
  private heatmapCanvas: HTMLCanvasElement | null = null;
  private cachedZoom = -1;

  constructor(canvas: HTMLCanvasElement, onRender?: () => void) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    this.ctx = ctx;
    this.onRender = onRender;

    this.initKernelSprite();
    this.resize();
    window.addEventListener('resize', () => {
      this.resize();
      this.draw();
    });
    this.setupInteractions();
  }

  private initKernelSprite(): void {
    const r = 32;
    const size = r * 2;
    const offscreen = document.createElement('canvas');
    offscreen.width = size;
    offscreen.height = size;
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    // Multi-stop heat kernel matching MapLibre heatmap colors
    const grad = octx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0.0, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.18, 'rgba(239, 68, 68, 0.55)');   // Crimson
    grad.addColorStop(0.40, 'rgba(245, 158, 11, 0.35)');  // Orange-yellow
    grad.addColorStop(0.65, 'rgba(56, 189, 248, 0.18)');  // Cyan
    grad.addColorStop(0.85, 'rgba(30, 58, 138, 0.08)');   // Deep blue
    grad.addColorStop(1.0, 'rgba(15, 23, 42, 0.0)');      // Transparent

    octx.fillStyle = grad;
    octx.beginPath();
    octx.arc(r, r, r, 0, Math.PI * 2);
    octx.fill();

    this.kernelCanvas = offscreen;
  }

  private updateHeatmapCache(): void {
    if (!this.kernelCanvas || this.pointCount === 0) return;
    const scale = 256 * Math.pow(2, this.zoom);
    const worldW = Math.round(scale);
    const worldH = Math.round(scale);

    const offscreen = document.createElement('canvas');
    offscreen.width = worldW;
    offscreen.height = worldH;
    const octx = offscreen.getContext('2d');
    if (!octx) return;

    octx.globalCompositeOperation = 'lighter';
    const baseR = Math.max(16, Math.min(48, 22 * Math.pow(1.2, this.zoom - 2)));
    const pts = this.points;
    const count = this.pointCount;

    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const pmx = pts[idx];
      const pmy = pts[idx + 1];
      const weight = pts[idx + 2];

      const sx = pmx * scale;
      const sy = pmy * scale;
      const r = baseR * (0.7 + weight * 0.6);
      octx.drawImage(this.kernelCanvas, sx - r, sy - r, r * 2, r * 2);
    }

    // Epicenter dots
    octx.globalCompositeOperation = 'source-over';
    octx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    for (let i = 0; i < count; i++) {
      const idx = i * 3;
      const sx = pts[idx] * scale;
      const sy = pts[idx + 1] * scale;
      octx.beginPath();
      octx.arc(sx, sy, 1.5, 0, Math.PI * 2);
      octx.fill();
    }

    this.heatmapCanvas = offscreen;
    this.cachedZoom = this.zoom;
  }

  async load(baseDir = '../../..'): Promise<void> {
    const [landRes, eqRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/maplibre-053-create-a-heatmap-layer/land.json`),
      fetch(`${baseDir}/data/baked/maplibre-053-create-a-heatmap-layer/earthquakes.bin`),
    ]);

    this.polygons = (await landRes.json()) as Polygon[];
    const eqBuf = await eqRes.arrayBuffer();
    const count = new Uint32Array(eqBuf, 4, 1)[0];
    this.pointCount = count;
    this.points = new Float32Array(eqBuf, 8, count * 3);

    this.updateHeatmapCache();
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
    this.updateHeatmapCache();
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
      this.setZoom(Math.max(1.0, Math.min(10.0, this.zoom + zoomDelta)));
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

    // 1. Dark ocean background
    ctx.fillStyle = '#0b1326';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);

    // 2. Continents / Land Polygons (with world copies for antimeridian wrap)
    ctx.fillStyle = '#182236';
    ctx.strokeStyle = '#23324d';
    ctx.lineWidth = 1;

    for (let copy = -1; copy <= 1; copy++) {
      const offsetX = copy * scale;
      for (const poly of this.polygons) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const rx = w / 2 + (ring[i][0] - centerMx) * scale + offsetX;
            const ry = h / 2 + (ring[i][1] - centerMy) * scale;
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    // 3. Heatmap Layer: Cached World Density Field
    if (this.heatmapCanvas) {
      for (let copy = -1; copy <= 1; copy++) {
        const sx = w / 2 - centerMx * scale + copy * scale;
        const sy = h / 2 - centerMy * scale;
        ctx.drawImage(this.heatmapCanvas, sx, sy);
      }
    }

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
