type Polygon = [number, number][][];
type Line = [number, number][];
type RoadType = 'SR' | 'US' | 'I';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const STYLE: Record<RoadType, { color: string; width: number }> = {
  SR: { color: '#ff7f2a', width: 2 },
  US: { color: '#2e9e5b', width: 3 },
  I: { color: '#3b6fd4', width: 3 },
};
const DRAW_ORDER: RoadType[] = ['SR', 'US', 'I'];

export class FiltersMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  land: Polygon[] = [];
  groups: Record<RoadType, Line[]> = { SR: [], US: [], I: [] };
  probes: Record<RoadType, [number, number]> = { SR: [0, 0], US: [0, 0], I: [0, 0] };
  visible: Record<RoadType, boolean> = { SR: true, US: true, I: true };
  center = { lon: -122.25, lat: 37.6 };
  zoom = 8;
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
    const [landRes, roadRes] = await Promise.all([
      fetch(`${baseDir}/data/baked/tangram-001-filters-demo/land.json`),
      fetch(`${baseDir}/data/baked/tangram-001-filters-demo/roads.json`),
    ]);
    this.land = (await landRes.json()) as Polygon[];
    const roads = (await roadRes.json()) as { groups: Record<RoadType, Line[]>; probes: Record<RoadType, [number, number]> };
    this.groups = roads.groups;
    this.probes = roads.probes;
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

  setTypeVisible(type: RoadType, on: boolean): void {
    this.visible[type] = on;
    this.draw();
  }

  screenFromMercator(mx: number, my: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const scale = 256 * Math.pow(2, this.zoom);
    return [
      w / 2 + (mx - mercX(this.center.lon)) * scale,
      h / 2 + (my - mercY(this.center.lat)) * scale,
    ];
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
      // Keep the point under the pointer still: move it to the centre, zoom,
      // then move it back to the pointer at the new scale.
      const r = this.canvas.getBoundingClientRect();
      const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
      this.panBy(-ox, -oy);
      this.setZoom(Math.max(1, Math.min(14, this.zoom + (e.deltaY < 0 ? 0.25 : -0.25))));
      this.panBy(ox, oy);
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = '#b8d6e8';
    ctx.fillRect(0, 0, w, h);

    const scale = 256 * Math.pow(2, this.zoom);
    const centerMx = mercX(this.center.lon);
    const centerMy = mercY(this.center.lat);
    const originX = w / 2 - centerMx * scale;
    const originY = h / 2 - centerMy * scale;

    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#dad7d0';
    ctx.lineWidth = 1;
    for (const poly of this.land) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const x = originX + ring[i][0] * scale;
          const y = originY + ring[i][1] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const type of DRAW_ORDER) {
      if (!this.visible[type]) continue;
      const style = STYLE[type];
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.beginPath();
      for (const line of this.groups[type]) {
        for (let i = 0; i < line.length; i++) {
          const x = originX + line[i][0] * scale;
          const y = originY + line[i][1] * scale;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      // One stroke per class: the class is the filter unit.
      ctx.stroke();
    }

    ctx.restore();
  }
}
