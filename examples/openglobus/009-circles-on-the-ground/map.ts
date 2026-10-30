type Polygon = [number, number][][];

interface GroundCircle {
  name: string;
  lon: number;
  lat: number;
  radiusM: number;
  color: string;
  ring: [number, number][];
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const hexA = (hex: string, alpha: number): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
};

export class CirclesMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  circles: GroundCircle[] = [];
  center = { lon: 0, lat: 25 };
  zoom = 2;
  dpr = 1;

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
    const [landRes, circleRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/openglobus-009-circles-on-the-ground/land.json`),
      fetch(`${baseDir}/data/baked/openglobus-009-circles-on-the-ground/circles.json`),
    ]);
    this.polygons = (await landRes.json()) as Polygon[];
    this.circles = (await circleRes.json()) as GroundCircle[];
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

  // Zoom keeping the point under (x, y) in CSS pixels where it was.
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

  circleRadiusPx(name: string): number {
    const c = this.circles.find((x) => x.name === name);
    if (!c) return 0;
    const mid = c.ring.length >> 1;
    const [x0] = this.screenFromMercator(c.ring[0][0], c.ring[0][1]);
    const [x1] = this.screenFromMercator(c.ring[mid][0], c.ring[mid][1]);
    return Math.abs(x1 - x0) / 2;
  }

  private setupInteractions(): void {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.last = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
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
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
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
    const minWrap = Math.floor(mercX(this.center.lon) - w / (2 * scale));
    const maxWrap = Math.ceil(mercX(this.center.lon) + w / (2 * scale));
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

    for (const c of this.circles) {
      ctx.beginPath();
      for (let i = 0; i < c.ring.length; i++) {
        const x = originX + c.ring[i][0] * scale;
        const y = originY + c.ring[i][1] * scale;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = hexA(c.color, 0.28);
      ctx.fill();
      ctx.strokeStyle = c.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.font = 'bold 12px system-ui, sans-serif';
    for (const c of this.circles) {
      const [x, y] = this.screenFromMercator(mercX(c.lon), mercY(c.lat));
      const label = `${c.name} ${Math.round(c.radiusM / 1000)} km`;
      ctx.strokeStyle = 'rgba(11, 18, 32, 0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, x, y - 4);
      ctx.fillStyle = c.color;
      ctx.fillText(label, x, y - 4);
    }

    ctx.restore();
  }
}
