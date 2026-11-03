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
  // 10m land for the area of the opening view, drawn over the 110m land.
  coast: { bbox: number[]; polygons: Polygon[] } = { bbox: [0, 0, 0, 0], polygons: [] };
  // Each layer as one Path2D, built once in Mercator units relative to an
  // origin near the data: a frame only sets the transform. Relative, so that
  // float32 path coordinates stay well under a pixel at z14 (4.2M px/unit).
  // The glow keeps one path per line: overlapping lines (both directions of
  // a road) add up their translucent glow, as they did when drawn one by one.
  private paths: { land: Path2D; coast: Path2D; roads: Path2D; glows: Path2D[]; o: [number, number] } | null = null;
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
    const [landRes, hwRes, coastRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/tangram-004-highways-demo/land.json`),
      fetch(`${baseDir}/data/baked/tangram-004-highways-demo/highways.json`),
      fetch(`${baseDir}/data/baked/tangram-004-highways-demo/coast.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.highways = (await hwRes.json()) as Line[];
    this.coast = (await coastRes.json()) as typeof this.coast;
    const [bx0, by0, bx1, by1] = this.coast.bbox;
    const o: [number, number] = [(bx0 + bx1) / 2, (by0 + by1) / 2];
    const build = (lines: [number, number][][], closed: boolean): Path2D => {
      const p = new Path2D();
      for (const line of lines) {
        line.forEach(([x, y], i) => (i ? p.lineTo(x - o[0], y - o[1]) : p.moveTo(x - o[0], y - o[1])));
        if (closed) p.closePath();
      }
      return p;
    };
    this.paths = {
      land: build(this.polygons.flat(), true), coast: build(this.coast.polygons.flat(), true),
      roads: build(this.highways, false), glows: this.highways.map((l) => build([l], false)), o,
    };
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
      this.setZoom(Math.max(5, Math.min(14, this.zoom + zoomDelta)));
      this.panBy(ox, oy);
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

    if (!this.paths) { ctx.restore(); return; }
    const { land, coast, roads, glows, o } = this.paths;
    // Mercator (relative to o) to CSS px, shifted by whole worlds
    const at = (wrap: number): void => ctx.setTransform(
      this.dpr * scale, 0, 0, this.dpr * scale,
      this.dpr * (w / 2 + (o[0] - centerMx + wrap) * scale), this.dpr * (h / 2 + (o[1] - centerMy) * scale));

    // 1. Land, one copy per world the screen spans, or it ends at 180°
    ctx.fillStyle = '#1e2430';
    ctx.strokeStyle = '#2e3846';
    ctx.lineWidth = 1 / scale;
    const wrapMin = Math.floor(centerMx - w / 2 / scale), wrapMax = Math.floor(centerMx + w / 2 / scale);
    for (let wrap = wrapMin; wrap <= wrapMax; wrap++) {
      at(wrap);
      ctx.fill(land);
      ctx.stroke(land);
    }

    // 1b. Inside the detail box, sea first and then the 10m land. The baked
    // polygons reach past the box, so their cut edges are clipped away.
    const [bx0, by0, bx1, by1] = this.coast.bbox;
    at(0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(bx0 - o[0], by0 - o[1], bx1 - bx0, by1 - by0);
    ctx.clip();
    ctx.fillStyle = '#151922';
    ctx.fill();
    ctx.fillStyle = '#1e2430';
    ctx.fill(coast);
    ctx.stroke(coast);
    ctx.restore();

    // 2. Highways (zoom-dependent width: z6 ~1 px, z8 ~2.2 px, z10 ~4.5 px),
    // a glow pass and a core pass
    const coreWidth = Math.max(1.0, Math.pow(1.5, this.zoom - 6.0));
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
    ctx.lineWidth = (coreWidth * 2.8) / scale;
    for (const glow of glows) ctx.stroke(glow);
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = coreWidth / scale;
    ctx.stroke(roads);

    ctx.restore();
    if (this.onRender) this.onRender();
  }
}
