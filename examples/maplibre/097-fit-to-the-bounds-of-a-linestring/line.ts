export interface FitLineMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  centerMercator: [number, number];
  zoom: number;
  lineBounds: [[number, number], [number, number]];
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  fitLine(): void;
  getScreenPos(lon: number, lat: number): [number, number];
  baseReady(): number;
  baseVisible(): number;
  baseLoaded(): boolean;
  resetView(): void;
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

const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;

// MapLibre "Fit to the bounds of a LineString": open over downtown
// Washington, DC, then fit the walk with 20 px of padding.
const START_CENTER: [number, number] = [-77.0214, 38.897];
const START_ZOOM = 12;
const PADDING = 20;
const LINE_COLOUR = '#BF93E4';
const LINE_WIDTH = 5;

const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(START_CENTER[0]);
const defaultCenterMy = mercY(START_CENTER[1]);

// The LineString is baked in mercator at 8 decimals; the bounds below are
// recomputed from those same coordinates at load time.
export async function mount(
  canvas: HTMLCanvasElement,
  routeUrl: string,
  landUrl: string,
): Promise<FitLineMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  let tileJson: TileJSON | null = null;
  const tiles = new Map<string, TileEntry>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let inFlight = 0;
  let rafId = 0;

  const [routeRes, landRes] = await Promise.all([fetch(routeUrl), fetch(landUrl)]);
  if (!routeRes.ok) throw new Error(`failed to fetch route: ${routeRes.status}`);
  if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);
  const route = (await routeRes.json()) as [number, number][];
  const polygons = (await landRes.json()) as Polygon[];

  let minMx = Infinity, maxMx = -Infinity, minMy = Infinity, maxMy = -Infinity;
  for (const [mx, my] of route) {
    if (mx < minMx) minMx = mx;
    if (mx > maxMx) maxMx = mx;
    if (my < minMy) minMy = my;
    if (my > maxMy) maxMy = my;
  }
  const lineBounds: [[number, number], [number, number]] = [
    [minMx * 360 - 180, (Math.atan(Math.exp((1 - 2 * maxMy) * Math.PI)) * 360) / Math.PI - 90],
    [maxMx * 360 - 180, (Math.atan(Math.exp((1 - 2 * minMy) * Math.PI)) * 360) / Math.PI - 90],
  ];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = START_ZOOM;
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

  // MapLibre's cameraForBounds with padding: the centre is the mercator
  // midpoint and the zoom is the larger of the two scales that fits the
  // padded viewport.
  function fitLine(): void {
    centerMx = (minMx + maxMx) / 2;
    centerMy = (minMy + maxMy) / 2;
    const scale = Math.min(
      (width - 2 * PADDING) / (maxMx - minMx),
      (height - 2 * PADDING) / (maxMy - minMy),
    );
    zoom = Math.max(1, Math.min(20, Math.log2(scale / 256)));
    draw();
  }

  // ---- raster base map -----------------------------------------------------
  interface BaseLayout {
    zi: number; n: number; tile: number;
    originX: number; originY: number;
    x0: number; x1: number; y0: number; y1: number;
  }

  function baseLayout(): BaseLayout | null {
    if (!tileJson) return null;
    const zi = Math.max(tileJson.minzoom, Math.min(tileJson.maxzoom, Math.round(zoom + Math.log2(dpr) - 1)));
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
          const r = await fetch(url);
          if (!r.ok) throw new Error(String(r.status));
          entry.bitmap = await createImageBitmap(await r.blob());
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
      const r = await fetch(TILE_STYLE);
      if (!r.ok) return;
      tileJson = (await r.json()) as TileJSON;
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

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = LAND;
    ctx.strokeStyle = LAND_EDGE;
    ctx.lineWidth = 1;
    for (const poly of polygons) {
      if (poly.length === 0) continue;
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
      // Stroke the coast, not the 180° cut (Natural Earth splits land there).
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1], b = ring[i];
          if ((a[0] <= 0 && b[0] <= 0) || (a[0] >= 1 && b[0] >= 1)) continue;
          ctx.moveTo(originX + a[0] * scale, originY + a[1] * scale);
          ctx.lineTo(originX + b[0] * scale, originY + b[1] * scale);
        }
      }
      ctx.stroke();
    }

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

    if (route.length > 1) {
      ctx.beginPath();
      for (let i = 0; i < route.length; i++) {
        const sx = originX + route[i][0] * scale;
        const sy = originY + route[i][1] * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.strokeStyle = LINE_COLOUR;
      ctx.lineWidth = LINE_WIDTH;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

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
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    zoomAtPoint(e.clientX - r.left, e.clientY - r.top, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
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

  function panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(1, Math.min(20, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = START_ZOOM;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);

  resize();
  void loadBase();

  return {
    canvas,
    ctx,
    get centerMercator(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom(): number {
      return zoom;
    },
    lineBounds,
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    fitLine,
    getScreenPos,
    baseReady: readyTiles,
    baseVisible(): number {
      const L = baseLayout();
      return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
    },
    baseLoaded(): boolean {
      return tileJson !== null;
    },
    resetView,
    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
    },
  };
}
