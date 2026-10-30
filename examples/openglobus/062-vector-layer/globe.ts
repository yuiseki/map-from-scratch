type Polygon = [number, number][][];

export class OpenGlobusVectorGlobe {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];

  yaw = 0;       // Center at lon 0
  pitch = 0.3;   // ~17 deg North
  zoom = 1.0;
  dpr = 1;

  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private onRender?: () => void;
  private oceanGrad: CanvasGradient | null = null;

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
    const res = await fetch(`${baseDir}/data/baked/openglobus-062-vector-layer/countries.json`);
    this.polygons = (await res.json()) as Polygon[];
    this.draw();
  }

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
    grad.addColorStop(0, '#0f2240');
    grad.addColorStop(0.75, '#071326');
    grad.addColorStop(1, '#030814');
    this.oceanGrad = grad;
  }

  rotateBy(dyaw: number, dpitch: number): void {
    this.yaw += dyaw;
    this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch + dpitch));
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = zoom;
    this.resize();
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

    // Deep space
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, w, h);

    // Globe ocean sphere
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fillStyle = this.oceanGrad || '#071326';
    ctx.fill();

    // OpenGlobus atmosphere glow rim
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.4)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Clip to globe disc
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2);
    ctx.clip();

    // Pass 1: Land Fills
    ctx.fillStyle = '#162032';
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
        if (anyVisible) ctx.fill();
      }
    }

    // Pass 2: Glow Border Pass
    ctx.strokeStyle = 'rgba(6, 182, 212, 0.35)';
    ctx.lineWidth = 3.5;
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
        if (anyVisible) ctx.stroke();
      }
    }

    // Pass 3: Core Cyan Vector Borders
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 1.2;
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
        if (anyVisible) ctx.stroke();
      }
    }

    ctx.restore(); // end globe clip
    ctx.restore(); // end dpr scale

    if (this.onRender) this.onRender();
  }
}
