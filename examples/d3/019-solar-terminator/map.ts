type Polygon = [number, number][][];

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercLat = (my: number): number =>
  ((2 * Math.atan(Math.exp((0.5 - my) * 2 * Math.PI)) - Math.PI / 2) * 180) / Math.PI;

const DEG = Math.PI / 180;
const DAY_OF_YEAR = 303; // 2026-10-30, the date the page shows

// NOAA's compact solar position: declination and equation of time from the
// fractional year. Good to a few hundredths of a degree.
function solar(utcHours: number): { dec: number; eqTime: number } {
  const gamma = ((2 * Math.PI) / 365) * (DAY_OF_YEAR - 1 + (utcHours - 12) / 24);
  const dec = 0.006918
    - 0.399912 * Math.cos(gamma) + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma) + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma) + 0.00148 * Math.sin(3 * gamma);
  const eqTime = 229.18 * (0.000075 + 0.001868 * Math.cos(gamma) - 0.032077 * Math.sin(gamma)
    - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma));
  return { dec: dec / DEG, eqTime };
}

const normLon = (lon: number): number => ((lon + 540) % 360) - 180;

export class SolarTerminatorMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  polygons: Polygon[] = [];
  center = { lon: 0, lat: 20 };
  zoom = 2;
  dpr = 1;
  hour = 12; // UTC hours, 0..24

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
    const res = await fetch(`${baseDir}/data/baked/d3-019-solar-terminator/land.json`);
    this.polygons = (await res.json()) as Polygon[];
    this.draw();
  }

  setUtcHour(hour: number): void {
    this.hour = ((hour % 24) + 24) % 24;
    this.draw();
  }

  subsolar(): { lon: number; lat: number } {
    const { dec, eqTime } = solar(this.hour);
    return { lon: normLon(-15 * (this.hour + eqTime / 60 - 12)), lat: dec };
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
    this.center.lon = normLon(this.center.lon - dx / scale * 360);
    const my = mercY(this.center.lat) - dy / scale;
    this.center.lat = mercLat(Math.max(0.02, Math.min(0.98, my)));
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(1, Math.min(6, zoom));
    this.draw();
  }

  // Zoom keeping the point under (x, y) in CSS pixels where it was, as
  // MapLibre and Leaflet do.
  zoomAt(zoom: number, x: number, y: number): void {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = this.worldScale();
    const mx = mercX(this.center.lon) + (x - w / 2) / scale;
    const my = mercY(this.center.lat) + (y - h / 2) / scale;
    this.zoom = Math.max(1, Math.min(6, zoom));
    const next = this.worldScale();
    this.center.lon = normLon((mx - (x - w / 2) / next) * 360 - 180);
    this.center.lat = mercLat(Math.max(0.02, Math.min(0.98, my - (y - h / 2) / next)));
    this.draw();
  }

  screenPos(lon: number, lat: number): { x: number; y: number } {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    return {
      x: w / 2 + (mercX(lon) - mercX(this.center.lon)) * scale,
      y: h / 2 + (mercY(lat) - mercY(this.center.lat)) * scale,
    };
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

  private worldScale(): number {
    return 256 * Math.pow(2, this.zoom);
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = this.worldScale();
    const centerX = mercX(this.center.lon);
    const centerY = mercY(this.center.lat);
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    ctx.fillStyle = '#a9d3ea';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#c9c4b8';
    ctx.lineWidth = 0.75;
    const minWrap = Math.floor(centerX - w / (2 * scale));
    const maxWrap = Math.ceil(centerX + w / (2 * scale));
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const originX = w / 2 + (wrap - centerX) * scale;
      for (const poly of this.polygons) {
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const x = originX + ring[i][0] * scale;
            const y = h / 2 + (ring[i][1] - centerY) * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    this.drawNight(ctx, w, h, scale, centerX, centerY);

    const sun = this.subsolar();
    const p = this.screenPos(sun.lon, sun.lat);
    ctx.save();
    ctx.shadowColor = 'rgba(255, 209, 102, 0.9)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd166';
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = 'bold 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.85)';
    ctx.lineWidth = 3;
    ctx.strokeText('太陽直下点', p.x, p.y + 9);
    ctx.fillStyle = '#fff7db';
    ctx.fillText('太陽直下点', p.x, p.y + 9);

    ctx.restore();
  }

  // The night side is drawn row by row in screen space. The sun is up where
  // sin(lat)sin(dec) + cos(lat)cos(dec)cos(H) > 0, so the night covers
  // |H| > acos(-k) around the subsolar meridian, k = tan(lat)tan(dec): one
  // band of half-width acos(k) centred on the antisolar meridian. Each row is
  // one or two rectangles, with no projected circle to close over a pole, and
  // it stays exact under any pan or zoom.
  private drawNight(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    scale: number,
    centerX: number,
    centerY: number,
  ): void {
    const { dec } = solar(this.hour);
    const sun = this.subsolar();
    const antiLon = normLon(sun.lon + 180);
    const tanDec = Math.tan(dec * DEG);
    ctx.beginPath();
    for (let y = 0; y < h; y += 1) {
      const my = centerY + (y + 0.5 - h / 2) / scale;
      if (my < 0 || my > 1) continue;
      const lat = mercLat(my);
      const k = Math.tan(lat * DEG) * tanDec;
      if (k >= 1) continue; // polar day
      if (k <= -1) {
        ctx.rect(0, y, w, 1); // polar night
        continue;
      }
      const half = (Math.acos(k) / DEG) * scale / 360; // night half-width, antisolar-centred
      const mid = w / 2 + (mercX(antiLon) - centerX) * scale;
      for (let wrap = -2; wrap <= 2; wrap++) {
        const shift = wrap * scale;
        const x0 = Math.max(0, mid - half + shift);
        const x1 = Math.min(w, mid + half + shift);
        if (x0 < x1) ctx.rect(x0, y, x1 - x0, 1);
      }
    }
    ctx.fillStyle = 'rgba(8, 14, 40, 0.62)';
    ctx.fill();
  }
}
