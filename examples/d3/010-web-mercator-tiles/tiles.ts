export interface TileJSON {
  name: string;
  attribution: string;
  minzoom: number;
  maxzoom: number;
  tiles: string[];
  tileSize: number;
  center?: [number, number, number];
}

export const TILEJSON_URL = 'https://tile.yuiseki.net/styles/512/osm-carto.json';

// Anything still showing this colour after a view finishes loading is a hole
// between tiles; the checks read it back by exact RGB.
const BACKGROUND = '#e9eef2';
const MAX_IN_FLIGHT = 6;

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const invMercY = (my: number): number =>
  (2 * Math.atan(Math.exp((0.5 - my) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI);

interface TileEntry {
  state: 'loading' | 'ready' | 'error';
  bitmap?: ImageBitmap;
}

interface Layout {
  zi: number;
  n: number;
  tileDev: number;
  originX: number;
  originY: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export class GridTileMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center = { lon: 139.7671, lat: 35.6812 };
  zoom = 5;
  dpr = 1;
  showGrid = true;
  onDraw?: () => void;
  tileJson: TileJSON | null = null;
  attribution = '';

  private tiles = new Map<string, TileEntry>();
  private pending = new Set<Promise<void>>();
  private queued = new Set<string>();
  private queue: string[] = [];
  private inFlight = 0;
  private rafId = 0;
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

  async load(url = TILEJSON_URL): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`TileJSON ${res.status}`);
    const tj = (await res.json()) as TileJSON;
    this.tileJson = tj;
    this.attribution = GridTileMap.plainText(tj.attribution);
    // The style is centred on Tokyo at z12; start six levels out and let the
    // user zoom into the tiles.
    if (tj.center) this.center = { lon: tj.center[0], lat: tj.center[1] };
    await this.loadView();
  }

  // The attribution arrives as HTML with entities; strip the tags and decode
  // the handful of entities it uses instead of injecting remote HTML.
  private static plainText(html: string): string {
    return html
      .replace(/<[^>]*>/g, '')
      .replaceAll('&copy;', '©')
      .replaceAll('&quot;', '"')
      .replaceAll('&#39;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&');
  }

  // CSS px per whole world at the fractional zoom.
  private worldScale(): number {
    return (this.tileJson?.tileSize ?? 512) * Math.pow(2, this.zoom);
  }

  private layout(): Layout | null {
    const tj = this.tileJson;
    if (!tj) return null;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const zi = Math.max(tj.minzoom, Math.min(tj.maxzoom, Math.round(this.zoom)));
    const n = 1 << zi;
    const scale = this.worldScale() * this.dpr;
    const tileDev = scale / n;
    const originX = W / 2 - mercX(this.center.lon) * scale;
    const originY = H / 2 - mercY(this.center.lat) * scale;
    return {
      zi,
      n,
      tileDev,
      originX,
      originY,
      x0: Math.floor(-originX / tileDev),
      x1: Math.floor((W - originX) / tileDev),
      y0: Math.max(0, Math.floor(-originY / tileDev)),
      y1: Math.min(n - 1, Math.floor((H - originY) / tileDev)),
    };
  }

  private keyOf(z: number, x: number, y: number): string {
    const n = 1 << z;
    return `${z}/${((x % n) + n) % n}/${y}`;
  }

  private resize(): void {
    this.dpr = window.devicePixelRatio || 1;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  panBy(dx: number, dy: number): void {
    const s = this.worldScale();
    const cx = mercX(this.center.lon) - dx / s;
    const cy = mercY(this.center.lat) - dy / s;
    this.center.lon = cx * 360 - 180;
    this.center.lat = invMercY(cy);
    this.draw();
  }

  setZoom(zoom: number): void {
    this.zoom = Math.max(0, Math.min(20, zoom));
    this.draw();
  }

  zoomAtPoint(x: number, y: number, z: number): void {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const [mx, my] = this.worldAtScreen(x, y);
    this.zoom = Math.max(0, Math.min(20, z));
    const s = this.worldScale();
    const cx = mx - (x - w / 2) / s;
    const cy = my - (y - h / 2) / s;
    this.center.lon = cx * 360 - 180;
    this.center.lat = invMercY(cy);
    this.draw();
  }

  screenOfWorld(mx: number, my: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const s = this.worldScale();
    return [w / 2 + (mx - mercX(this.center.lon)) * s, h / 2 + (my - mercY(this.center.lat)) * s];
  }

  worldAtScreen(x: number, y: number): [number, number] {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const s = this.worldScale();
    return [mercX(this.center.lon) + (x - w / 2) / s, mercY(this.center.lat) + (y - h / 2) / s];
  }

  // z/x/y of the tile under a CSS pixel, or null above/below the world.
  tileAddressAt(x: number, y: number): string | null {
    const L = this.layout();
    if (!L) return null;
    const tx = Math.floor((x * this.dpr - L.originX) / L.tileDev);
    const ty = Math.floor((y * this.dpr - L.originY) / L.tileDev);
    if (ty < 0 || ty >= L.n) return null;
    return this.keyOf(L.zi, tx, ty);
  }

  // Tile boundaries in CSS px, from the same expression the draw loop uses.
  tileEdges(): { xs: number[]; ys: number[] } {
    const L = this.layout();
    if (!L) return { xs: [], ys: [] };
    const xs: number[] = [];
    const ys: number[] = [];
    for (let x = L.x0; x <= L.x1; x++) xs.push(Math.round(L.originX + (x + 1) * L.tileDev) / this.dpr);
    for (let y = L.y0; y <= L.y1; y++) ys.push(Math.round(L.originY + (y + 1) * L.tileDev) / this.dpr);
    return { xs, ys };
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
      this.zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, this.zoom + (e.deltaY < 0 ? 0.4 : -0.4));
    }, { passive: false });
  }

  draw(): void {
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, W, H);
    const L = this.layout();
    if (!L) return;

    // Each edge is derived from the origin and the integer index in one
    // expression and rounded in device pixels, so neighbours share the same
    // boundary and no background line can show between them.
    for (let x = L.x0; x <= L.x1; x++) {
      const X0 = Math.round(L.originX + x * L.tileDev);
      const X1 = Math.round(L.originX + (x + 1) * L.tileDev);
      for (let y = L.y0; y <= L.y1; y++) {
        const Y0 = Math.round(L.originY + y * L.tileDev);
        const Y1 = Math.round(L.originY + (y + 1) * L.tileDev);
        this.blitTile(ctx, L.zi, x, y, X0, Y0, X1 - X0, Y1 - Y0);
      }
    }

    if (this.showGrid) this.drawGrid(ctx, L);
    this.ensureVisible(L);
    this.trimCache(L);
    this.onDraw?.();
  }

  private drawGrid(ctx: CanvasRenderingContext2D, L: Layout): void {
    const W = this.canvas.width;
    const H = this.canvas.height;
    const dpr = this.dpr;
    ctx.save();
    // Grid lines sit on half pixels so a 1 px stroke covers one pixel row.
    ctx.strokeStyle = 'rgba(37,99,235,0.55)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = L.x0; x <= L.x1 + 1; x++) {
      const X = Math.round(L.originX + x * L.tileDev) + 0.5;
      if (X < 0 || X > W) continue;
      ctx.moveTo(X, 0);
      ctx.lineTo(X, H);
    }
    for (let y = L.y0; y <= L.y1 + 1; y++) {
      const Y = Math.round(L.originY + y * L.tileDev) + 0.5;
      if (Y < 0 || Y > H) continue;
      ctx.moveTo(0, Y);
      ctx.lineTo(W, Y);
    }
    ctx.stroke();

    ctx.font = `${Math.round(11 * dpr)}px system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 3 * dpr;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.fillStyle = '#1e3a8a';
    for (let x = L.x0; x <= L.x1; x++) {
      for (let y = L.y0; y <= L.y1; y++) {
        const X = Math.round(L.originX + x * L.tileDev) + 4 * dpr;
        const Y = Math.round(L.originY + y * L.tileDev) + 3 * dpr;
        const label = this.keyOf(L.zi, x, y);
        ctx.strokeText(label, X, Y);
        ctx.fillText(label, X, Y);
      }
    }
    ctx.restore();
  }

  private blitTile(
    ctx: CanvasRenderingContext2D,
    z: number,
    x: number,
    y: number,
    X: number,
    Y: number,
    W: number,
    H: number,
  ): void {
    const tj = this.tileJson;
    if (!tj) return;
    // Missing tile: stand in with the best cached ancestor's sub-rectangle.
    for (let dz = 0; dz <= 6; dz++) {
      const zz = z - dz;
      if (zz < tj.minzoom) return;
      const f = 1 << dz;
      const ax = Math.floor(x / f);
      const ay = Math.floor(y / f);
      const entry = this.tiles.get(this.keyOf(zz, ax, ay));
      const bm = entry && entry.state === 'ready' ? entry.bitmap : undefined;
      if (!bm) continue;
      const sx = ((x - ax * f) / f) * bm.width;
      const sy = ((y - ay * f) / f) * bm.height;
      ctx.drawImage(bm, sx, sy, bm.width / f, bm.height / f, X, Y, W, H);
      return;
    }
  }

  private ensureVisible(L: Layout): void {
    for (let x = L.x0; x <= L.x1; x++) {
      for (let y = L.y0; y <= L.y1; y++) this.requestTile(L.zi, x, y);
    }
  }

  private requestTile(z: number, x: number, y: number): void {
    const key = this.keyOf(z, x, y);
    if (this.tiles.has(key) || this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const key = this.queue.shift() as string;
      this.queued.delete(key);
      this.startLoad(key);
    }
  }

  private startLoad(key: string): void {
    const [zs, xs, ys] = key.split('/');
    const url = (this.tileJson as TileJSON).tiles[0]
      .replace('{z}', zs)
      .replace('{x}', xs)
      .replace('{y}', ys);
    const entry: TileEntry = { state: 'loading' };
    this.tiles.set(key, entry);
    this.inFlight++;
    const job = (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const bitmap = await createImageBitmap(await res.blob());
        entry.bitmap = bitmap;
        entry.state = 'ready';
      } catch {
        entry.state = 'error';
      } finally {
        this.inFlight--;
        this.pump();
        this.scheduleDraw();
      }
    })();
    this.pending.add(job);
    void job.finally(() => this.pending.delete(job));
  }

  private scheduleDraw(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.draw();
    });
  }

  private trimCache(L: Layout): void {
    if (this.tiles.size <= 200) return;
    for (const [key, entry] of this.tiles) {
      if (this.tiles.size <= 160) break;
      if (entry.state === 'loading') continue;
      const [zs, xs, ys] = key.split('/').map(Number);
      const visible = zs === L.zi && xs >= L.x0 && xs <= L.x1 && ys >= L.y0 && ys <= L.y1;
      if (visible) continue;
      entry.bitmap?.close();
      this.tiles.delete(key);
    }
  }

  // Resolves once every visible tile is decoded, failed, or absent.
  async loadView(): Promise<void> {
    for (let i = 0; i < 50; i++) {
      const L = this.layout();
      if (!L) break;
      this.ensureVisible(L);
      if (this.pending.size === 0 && this.queue.length === 0) break;
      await Promise.all([...this.pending]);
    }
    this.draw();
  }
}
