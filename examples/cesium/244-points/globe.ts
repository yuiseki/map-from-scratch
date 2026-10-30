type Polygon = [number, number][][];

interface Point {
  lon: number;
  lat: number;
  colorIdx: number;
  size: number;
}

const PALETTE = [
  '#facc15', // 0: Yellow
  '#06b6d4', // 1: Cyan
  '#84cc16', // 2: Lime
  '#ec4899', // 3: Magenta
  '#f97316', // 4: Orange
];

export class CesiumPointsGlobe {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  points: Point[] = [];

  yaw = 0;       // Center at lon 0 (London / Europe / Africa)
  pitch = 0.35;  // 20 degrees North
  zoom = 1.0;
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
    const [landRes, ptsRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/cesium-244-points/land.json`),
      fetch(`${baseDir}/data/baked/cesium-244-points/points.bin`),
    ]);

    this.polygons = (await landRes.json()) as Polygon[];

    const ab = await ptsRes.arrayBuffer();
    const count = new Uint32Array(ab, 4, 1)[0];
    const dv = new DataView(ab, 8);
    const pts: Point[] = [];

    for (let i = 0; i < count; i++) {
      const at = i * 8;
      const lon = dv.getInt16(at, true) / 100;
      const lat = dv.getInt16(at + 2, true) / 100;
      const colorIdx = dv.getUint8(at + 4);
      const size = dv.getUint8(at + 5);
      pts.push({ lon, lat, colorIdx, size });
    }

    this.points = pts;
    this.draw();
  }

  private oceanGrad: CanvasGradient | null = null;

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);

    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;
    const grad = this.ctx.createRadialGradient(
      cx - R * 0.25,
      cy - R * 0.25,
      R * 0.1,
      cx,
      cy,
      R
    );
    grad.addColorStop(0, '#1a365d');
    grad.addColorStop(0.75, '#0f223f');
    grad.addColorStop(1, '#081324');
    this.oceanGrad = grad;
  }

  rotateBy(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dpitch));
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
      this.rotateBy(dx * 0.005, -dy * 0.005);
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const zoomDelta = -e.deltaY * 0.002;
      this.setZoom(Math.max(0.6, Math.min(2.5, this.zoom + zoomDelta)));
    }, { passive: false });
  }

  project(lonDeg: number, latDeg: number): { sx: number; sy: number; visible: boolean; depth: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;

    const lon = (lonDeg * Math.PI) / 180;
    const lat = (latDeg * Math.PI) / 180;

    const cosLat = Math.cos(lat);
    const gx = cosLat * Math.cos(lon);
    const gy = cosLat * Math.sin(lon);
    const gz = Math.sin(lat);

    const cosY = Math.cos(this.yaw);
    const sinY = Math.sin(this.yaw);
    const x1 = gx * cosY + gy * sinY;
    const y1 = -gx * sinY + gy * cosY;
    const z1 = gz;

    const cosP = Math.cos(this.pitch);
    const sinP = Math.sin(this.pitch);
    const camX = y1;
    const camY = -x1 * sinP + z1 * cosP;
    const camZ = x1 * cosP + z1 * sinP;

    return {
      sx: cx + camX * R,
      sy: cy - camY * R,
      visible: camZ > 0.02,
      depth: camZ,
    };
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cx = w / 2;
    const cy = h / 2;
    const R = Math.min(w, h) * 0.42 * this.zoom;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // Deep space background
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);

    // Globe ocean sphere with atmosphere rim glow
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = this.oceanGrad || '#0f223f';
    ctx.fill();

    // Atmosphere halo
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Clip to globe disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    // Draw Land Polygons
    ctx.fillStyle = '#1e3a5f';
    ctx.strokeStyle = '#2d5380';
    ctx.lineWidth = 1;

    for (const poly of this.polygons) {
      for (const ring of poly) {
        ctx.beginPath();
        let anyVisible = false;
        let started = false;

        for (let i = 0; i < ring.length; i++) {
          const pt = this.project(ring[i][0], ring[i][1]);
          if (pt.visible) {
            anyVisible = true;
            if (!started) {
              ctx.moveTo(pt.sx, pt.sy);
              started = true;
            } else {
              ctx.lineTo(pt.sx, pt.sy);
            }
          } else {
            started = false;
          }
        }
        if (anyVisible) {
          ctx.fill();
          ctx.stroke();
        }
      }
    }

    // Draw 5,000 Points with Color Batching
    // 1. Project and collect visible points by palette index
    const batches: { sx: number; sy: number; r: number }[][] = [[], [], [], [], []];
    for (let i = 0; i < this.points.length; i++) {
      const p = this.points[i];
      const proj = this.project(p.lon, p.lat);
      if (!proj.visible) continue;

      const r = (p.size * 0.5) * (0.8 + proj.depth * 0.4);
      batches[p.colorIdx].push({ sx: proj.sx, sy: proj.sy, r });
    }

    // 2. Batch Draw: Outlines (1 draw call)
    ctx.beginPath();
    for (let c = 0; c < 5; c++) {
      const list = batches[c];
      for (let i = 0; i < list.length; i++) {
        const pt = list[i];
        ctx.moveTo(pt.sx + pt.r, pt.sy);
        ctx.arc(pt.sx, pt.sy, pt.r + 1.2, 0, Math.PI * 2);
      }
    }
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fill();

    // 3. Batch Draw: Point Fills (5 draw calls)
    for (let c = 0; c < 5; c++) {
      const list = batches[c];
      if (list.length === 0) continue;

      ctx.fillStyle = PALETTE[c];
      ctx.beginPath();
      for (let i = 0; i < list.length; i++) {
        const pt = list[i];
        ctx.moveTo(pt.sx + pt.r, pt.sy);
        ctx.arc(pt.sx, pt.sy, pt.r, 0, Math.PI * 2);
      }
      ctx.fill();
    }

    ctx.restore(); // end globe clip
    ctx.restore(); // end dpr scale

    if (this.onRender) this.onRender();
  }
}
