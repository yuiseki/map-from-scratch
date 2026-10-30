type Polygon = [number, number][][];

interface MapPoint {
  name: string;
  lon: number;
  lat: number;
  color: string;
  text: string;
  mx: number;
  my: number;
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const HIT_RADIUS = 13;

export class PopupPointsMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  points: MapPoint[] = [];
  activePopup: { text: string; mx: number; my: number } | null = null;

  center = { lon: 0, lat: 25 };
  zoom = 2;
  dpr = 1;

  private dragging = false;
  private last = { x: 0, y: 0 };
  private moved = false;
  private down = { x: 0, y: 0 };

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
    const [landRes, pointRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/openglobus-050-point-popup/land.json`),
      fetch(`${baseDir}/data/baked/openglobus-050-point-popup/points.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.points = (await pointRes.json()) as MapPoint[];
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
    this.zoom = Math.max(1, Math.min(8, zoom));
    this.draw();
  }

  zoomAt(zoom: number, x: number, y: number): void {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    const mx = mercX(this.center.lon) + (x - w / 2) / scale;
    const my = mercY(this.center.lat) + (y - h / 2) / scale;
    this.zoom = Math.max(1, Math.min(8, zoom));
    const next = 256 * Math.pow(2, this.zoom);
    const centerMx = mx - (x - w / 2) / next;
    const centerMy = my - (y - h / 2) / next;
    this.center.lon = centerMx * 360 - 180;
    const y2 = (0.5 - centerMy) * 2 * Math.PI;
    this.center.lat = (2 * Math.atan(Math.exp(y2)) - Math.PI / 2) * (180 / Math.PI);
    this.draw();
  }

  setCenter(lon: number, lat: number): void {
    this.center = { lon, lat };
    this.draw();
  }

  screenFromMercator(mx: number, my: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    return [w / 2 + (mx - mercX(this.center.lon)) * scale, h / 2 + (my - mercY(this.center.lat)) * scale];
  }

  // World copies that touch the viewport: land, points and hits all use it.
  wraps(): [number, number] {
    const half = this.canvas.width / this.dpr / (2 * 256 * Math.pow(2, this.zoom));
    const cx = mercX(this.center.lon);
    return [Math.floor(cx - half), Math.ceil(cx + half) - 1];
  }

  clickAtScreen(x: number, y: number): void {
    const [w0, w1] = this.wraps();
    for (let k = w0; k <= w1; k++) {
      for (const p of this.points) {
        const [sx, sy] = this.screenFromMercator(p.mx + k, p.my);
        if (Math.hypot(x - sx, y - sy) <= HIT_RADIUS) {
          this.activePopup = { text: p.text, mx: p.mx + k, my: p.my };
          this.draw();
          return;
        }
      }
    }
    this.activePopup = null;
    this.draw();
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.moved = false;
      this.last = { x: e.clientX, y: e.clientY };
      this.down = { x: e.clientX, y: e.clientY };
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.last.x;
      const dy = e.clientY - this.last.y;
      if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 3) this.moved = true;
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
      if (!this.moved) {
        const rect = this.canvas.getBoundingClientRect();
        this.clickAtScreen(e.clientX - rect.left, e.clientY - rect.top);
      }
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(this.zoom + (e.deltaY < 0 ? 0.25 : -0.25), e.clientX - rect.left, e.clientY - rect.top);
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

    ctx.fillStyle = '#1b2a41';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    const [minWrap, maxWrap] = this.wraps();
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const shiftX = originX + wrap * scale;
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

    // Points: a filled dot with a halo, plus a label underneath.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 12px system-ui, sans-serif';
    for (let k = minWrap; k <= maxWrap; k++) for (const p of this.points) {
      const [x, y] = this.screenFromMercator(p.mx + k, p.my);

      ctx.beginPath();
      ctx.arc(x, y, 12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.strokeStyle = '#0b1220';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();

      const label = `${p.name}`;
      ctx.strokeStyle = 'rgba(11, 18, 32, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, x, y + 22);
      ctx.fillStyle = p.color;
      ctx.fillText(label, x, y + 22);
    }

    if (this.activePopup) {
      const [px, py] = this.screenFromMercator(this.activePopup.mx, this.activePopup.my);
      ctx.font = '13px system-ui, sans-serif';
      const textWidth = ctx.measureText(this.activePopup.text).width;
      const pw = Math.max(150, textWidth + 24);
      const ph = 36;
      const popX = px - pw / 2;
      const popY = py - 30 - ph;

      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 10;
      ctx.shadowOffsetY = 3;
      ctx.beginPath();
      ctx.roundRect(popX, popY, pw, ph, 8);
      ctx.moveTo(px - 7, popY + ph);
      ctx.lineTo(px, popY + ph + 8);
      ctx.lineTo(px + 7, popY + ph);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = '#222222';
      ctx.fillText(this.activePopup.text, popX + 12, popY + 22);
      ctx.restore();
    }

    ctx.restore();
  }
}
