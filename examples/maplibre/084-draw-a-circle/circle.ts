export interface CircleMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  radiusM: number;
  center: [number, number];
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  setBaseVisible(v: boolean): void;
  baseReady(): number;
  baseVisible(): number;
  baseLoaded(): boolean;
  resetView(): void;
  getScreenPos(lng: number, lat: number): [number, number];
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

// The same 512 px raster style as the raster-tile example; the baked land
// polygons stand in until the covering tiles arrive.
const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';
const CIRCLE_FILL = 'rgba(0,128,255,0.5)';
const CIRCLE_STROKE = '#0080ff';

export async function mount(
  canvas: HTMLCanvasElement,
  circleUrl: string,
  landUrl: string,
): Promise<CircleMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  let tileJson: TileJSON | null = null;
  const tiles = new Map<string, TileEntry>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let inFlight = 0;
  let rafId = 0;
  let baseVisible = true;

  const [circleRes, landRes] = await Promise.all([fetch(circleUrl), fetch(landUrl)]);
  if (!circleRes.ok) throw new Error(`failed to fetch circle: ${circleRes.status}`);
  if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);

  const circle = (await circleRes.json()) as { center: [number, number]; radiusM: number; ring: Ring };
  const polygons = (await landRes.json()) as Polygon[];

  let centerMx = mercX(circle.center[0]);
  let centerMy = mercY(circle.center[1]);
  let zoom = 9;
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

  function getScreenPos(lng: number, lat: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (mercX(lng) - centerMx) * scale,
      height / 2 + (mercY(lat) - centerMy) * scale,
    ];
  }

  // ---- raster base map -----------------------------------------------------
  // The 512 px PNGs land near 512 device px: zi = round(zoom) at DPR 2, one
  // level lower at DPR 1 (round(zoom) drew the labels at half size there).
  interface BaseLayout {
    zi: number; n: number; tile: number;
    originX: number; originY: number;
    x0: number; x1: number; y0: number; y1: number;
  }

  function baseLayout(): BaseLayout | null {
    if (!tileJson) return null;
    const zi = Math.max(tileJson.minzoom, Math.min(tileJson.maxzoom, Math.round(zoom + Math.log2(devicePixelRatio || 1) - 1)));
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
          const res = await fetch(url);
          if (!res.ok) throw new Error(String(res.status));
          entry.bitmap = await createImageBitmap(await res.blob());
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
      const res = await fetch(TILE_STYLE);
      if (!res.ok) return;
      tileJson = (await res.json()) as TileJSON;
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
    const minWrap = Math.floor(centerMx - width / (2 * scale));
    const maxWrap = Math.floor(centerMx + width / (2 * scale));
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const shiftX = originX + wrap * scale;
      for (const poly of polygons) {
        if (poly.length === 0) continue;
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

    // Raster base map on top of the land placeholder.
    const L = baseLayout();
    if (baseVisible && L) {
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
    }
    if (L) {
      for (let x = L.x0; x <= L.x1; x++) {
        for (let y = L.y0; y <= L.y1; y++) requestTile(L.zi, wrapX(x, L.n), y);
      }
    }

    // The 50 km circle is baked as a mercator ring, so it scales with zoom
    // exactly like MapLibre's turf.circle polygon.
    ctx.beginPath();
    for (let i = 0; i < circle.ring.length; i++) {
      const x = originX + circle.ring[i][0] * scale;
      const y = originY + circle.ring[i][1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = CIRCLE_FILL;
    ctx.fill();
    ctx.strokeStyle = CIRCLE_STROKE;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomAt(e, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });
  window.addEventListener('resize', resize);

  // Zoom keeping the point under the pointer still (MapLibre, Leaflet do).
  function zoomAt(e: WheelEvent, z: number): void {
    const r = canvas.getBoundingClientRect();
    const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
    const before = 256 * Math.pow(2, zoom);
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

  resize();
  void loadBase();

  return {
    canvas,
    ctx,
    radiusM: circle.radiusM,
    get center(): [number, number] {
      return circle.center;
    },
    draw,
    panBy,
    setZoom,
    setBaseVisible(v: boolean): void {
      baseVisible = v;
      draw();
    },
    baseReady: readyTiles,
    baseVisible(): number {
      const L = baseLayout();
      return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
    },
    baseLoaded(): boolean {
      return tileJson !== null;
    },
    resetView(): void {
      centerMx = mercX(circle.center[0]);
      centerMy = mercY(circle.center[1]);
      zoom = 9;
      draw();
    },
    getScreenPos,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
