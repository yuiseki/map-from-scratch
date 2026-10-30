export interface PatternFillMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  resetView(): void;
  baseLoaded(): boolean;
  baseReady(): number;
  baseVisible(): number;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

interface TileJSON {
  tiles: string[];
  minzoom: number;
  maxzoom: number;
}
interface TileEntry {
  state: 'loading' | 'ready' | 'error';
  bitmap?: ImageBitmap;
}

// A regional (zoom 6) view needs a real base map: the baked land polygons are
// a flat beige fill at this scale, so they only stand in until the OSM raster
// tiles that cover Colorado arrive.
const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;

// A box over Colorado, the polygon the example fills with a pattern.
const WEST = -109;
const EAST = -102;
const SOUTH = 37;
const NORTH = 41;
const CENTER_LNG = (WEST + EAST) / 2;
const CENTER_LAT = (SOUTH + NORTH) / 2;
const DEFAULT_ZOOM = 6;

// Screen-space checkerboard: 12 px squares in a 24 px tile. The pattern is
// anchored to the canvas origin, as MapLibre anchors image patterns in screen
// space, so it does not scale with zoom.
const TILE = 24;
const HALF = TILE / 2;
const COLOR_A = '#f6e05e';
const COLOR_B = '#2b6cb0';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<PatternFillMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let tileJson: TileJSON | null = null;
  const tiles = new Map<string, TileEntry>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let inFlight = 0;
  let rafId = 0;

  const box: Ring = [
    [mercX(WEST), mercY(SOUTH)],
    [mercX(EAST), mercY(SOUTH)],
    [mercX(EAST), mercY(NORTH)],
    [mercX(WEST), mercY(NORTH)],
  ];

  const tile = document.createElement('canvas');
  tile.width = TILE;
  tile.height = TILE;
  const tctx = tile.getContext('2d');
  if (!tctx) throw new Error('2D context not available');
  tctx.fillStyle = COLOR_A;
  tctx.fillRect(0, 0, TILE, TILE);
  tctx.fillStyle = COLOR_B;
  tctx.fillRect(HALF, 0, HALF, HALF);
  tctx.fillRect(0, HALF, HALF, HALF);
  const created = ctx.createPattern(tile, 'repeat');
  if (!created) throw new Error('pattern not available');
  const pattern: CanvasPattern = created;

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = DEFAULT_ZOOM;
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }

  function getScreenPos(lon: number, lat: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (mercX(lon) - centerMx) * scale,
      height / 2 + (mercY(lat) - centerMy) * scale,
    ];
  }

  // ---- raster base map ---------------------------------------------------
  // 512 px PNGs drawn at 256*2^(zoom-zi) CSS px, so one PNG covers what a
  // 256 px tile at zi would. zi is picked so the PNG lands near 512 device px.
  interface BaseLayout {
    zi: number; n: number; tile: number;
    originX: number; originY: number;
    x0: number; x1: number; y0: number; y1: number;
  }

  function baseLayout(): BaseLayout | null {
    if (!tileJson) return null;
    const zi = Math.max(
      tileJson.minzoom,
      Math.min(tileJson.maxzoom, Math.round(zoom + Math.log2(dpr) - 1)),
    );
    const n = 1 << zi;
    const tile = 256 * Math.pow(2, zoom - zi);
    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;
    return {
      zi, n, tile, originX, originY,
      x0: Math.floor(-originX / tile),
      x1: Math.floor((width - originX) / tile),
      y0: Math.max(0, Math.floor(-originY / tile)),
      y1: Math.min(n - 1, Math.floor((height - originY) / tile)),
    };
  }

  const wrapX = (x: number, n: number): number => ((x % n) + n) % n;
  const tileKey = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;

  function requestTile(zi: number, wx: number, y: number): void {
    const key = tileKey(zi, wx, y);
    if (tiles.has(key) || queued.has(key)) return;
    queued.add(key);
    queue.push(key);
    pump();
  }

  function pump(): void {
    while (inFlight < MAX_IN_FLIGHT && queue.length > 0) {
      const key = queue.shift() as string;
      queued.delete(key);
      const [z, x, y] = key.split('/');
      const url = (tileJson as TileJSON).tiles[0]
        .replace('{z}', z).replace('{x}', x).replace('{y}', y);
      const entry: TileEntry = { state: 'loading' };
      tiles.set(key, entry);
      inFlight++;
      void (async () => {
        try {
          const tileRes = await fetch(url);
          if (!tileRes.ok) throw new Error(String(tileRes.status));
          entry.bitmap = await createImageBitmap(await tileRes.blob());
          entry.state = 'ready';
        } catch {
          entry.state = 'error';
        } finally {
          inFlight--;
          pump();
          scheduleDraw();
        }
      })();
    }
  }

  function scheduleDraw(): void {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      draw();
    });
  }

  async function loadBase(): Promise<void> {
    try {
      const styleRes = await fetch(TILE_STYLE);
      if (!styleRes.ok) return;
      tileJson = (await styleRes.json()) as TileJSON;
      scheduleDraw();
    } catch {
      // Offline: the baked land polygons remain the background.
    }
  }

  function readyTiles(): number {
    const L = baseLayout();
    if (!L) return 0;
    let ready = 0;
    for (let x = L.x0; x <= L.x1; x++) {
      for (let y = L.y0; y <= L.y1; y++) {
        if (tiles.get(tileKey(L.zi, wrapX(x, L.n), y))?.state === 'ready') ready++;
      }
    }
    return ready;
  }

  function visibleTiles(): number {
    const L = baseLayout();
    return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#b8d6e8';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#dad7d0';
    ctx.lineWidth = 1;

    const minWrap = Math.floor(centerMx - width / (2 * scale));
    const maxWrap = Math.floor(centerMx + width / (2 * scale));
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const shiftX = originX + wrap * scale;
      for (const poly of polygons) {
        if (poly.length === 0) continue;
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const rx = shiftX + ring[i][0] * scale;
            const ry = originY + ring[i][1] * scale;
            if (i === 0) ctx.moveTo(rx, ry);
            else ctx.lineTo(rx, ry);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    // Raster base map on top of the land placeholder.
    const L = baseLayout();
    if (L) {
      for (let x = L.x0; x <= L.x1; x++) {
        const X0 = Math.round(L.originX + x * L.tile);
        const X1 = Math.round(L.originX + (x + 1) * L.tile);
        for (let y = L.y0; y <= L.y1; y++) {
          const Y0 = Math.round(L.originY + y * L.tile);
          const Y1 = Math.round(L.originY + (y + 1) * L.tile);
          const entry = tiles.get(tileKey(L.zi, wrapX(x, L.n), y));
          if (entry?.state === 'ready' && entry.bitmap) {
            ctx.drawImage(entry.bitmap, X0, Y0, X1 - X0, Y1 - Y0);
          }
        }
      }
      for (let x = L.x0; x <= L.x1; x++) {
        for (let y = L.y0; y <= L.y1; y++) requestTile(L.zi, wrapX(x, L.n), y);
      }
    }

    // The polygon carries the pattern instead of a flat colour.
    ctx.beginPath();
    for (let i = 0; i < box.length; i++) {
      const sx = originX + box[i][0] * scale;
      const sy = originY + box[i][1] * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = pattern;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  }

  function zoomAtPoint(x: number, y: number, z: number): void {
    const before = 256 * Math.pow(2, zoom);
    const ox = x - width / 2;
    const oy = y - height / 2;
    centerMx += ox / before;
    centerMy += oy / before;
    setZoom(z);
    const after = 256 * Math.pow(2, zoom);
    centerMx -= ox / after;
    centerMy -= oy / after;
    draw();
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
  }

  function panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(1, Math.min(14, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = DEFAULT_ZOOM;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();
  void loadBase();

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    resetView,
    baseLoaded: () => tileJson !== null,
    baseReady: readyTiles,
    baseVisible: visibleTiles,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
