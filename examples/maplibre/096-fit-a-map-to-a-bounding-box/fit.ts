export interface FitBoundsMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  bounds: [[number, number], [number, number]];
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  fitBounds(): void;
  getScreenPos(lng: number, lat: number): [number, number];
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

// The same 512 px raster style as the other regional examples; the baked land
// polygons stand in until the covering tiles arrive.
const TILE_STYLE = 'https://tile.yuiseki.net/styles/512/osm-carto.json';
const MAX_IN_FLIGHT = 6;

// MapLibre "Fit a map to a bounding box": open over New York, then fit this
// box with the button.
const START_CENTER: [number, number] = [-74.5, 40];
const START_ZOOM = 9;
const BOUNDS: [[number, number], [number, number]] = [
  [32.958984, -5.353521],
  [43.50585, 5.615985],
];

const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';
const CORNER = '#e63946';
const CENTRE = '#1e6fd9';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(START_CENTER[0]);
const defaultCenterMy = mercY(START_CENTER[1]);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<FitBoundsMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  let tileJson: TileJSON | null = null;
  const tiles = new Map<string, TileEntry>();
  const queued = new Set<string>();
  const queue: string[] = [];
  let inFlight = 0;
  let rafId = 0;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  const boundsMerc: Ring = [
    [mercX(BOUNDS[0][0]), mercY(BOUNDS[0][1])],
    [mercX(BOUNDS[1][0]), mercY(BOUNDS[0][1])],
    [mercX(BOUNDS[1][0]), mercY(BOUNDS[1][1])],
    [mercX(BOUNDS[0][0]), mercY(BOUNDS[1][1])],
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

  // MapLibre's cameraForBounds with padding 0: centre is the mercator midpoint
  // and the zoom is the larger of the two axis scales that still fits.
  function fitBounds(): void {
    const [west, south] = BOUNDS[0];
    const [east, north] = BOUNDS[1];
    const minX = mercX(west), maxX = mercX(east);
    const minY = mercY(north), maxY = mercY(south);
    centerMx = (minX + maxX) / 2;
    centerMy = (minY + maxY) / 2;
    const scale = Math.min(width / (maxX - minX), height / (maxY - minY));
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

  function drawDot(x: number, y: number, r: number, colour: string): void {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = colour;
    ctx.fill();
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
        // Stroke the coast, not the 180° cut: Natural Earth splits land there,
        // and its edge drew a line across Chukotka.
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1], b = ring[i];
            if ((a[0] <= 0 && b[0] <= 0) || (a[0] >= 1 && b[0] >= 1)) continue;
            ctx.moveTo(shiftX + a[0] * scale, originY + a[1] * scale);
            ctx.lineTo(shiftX + b[0] * scale, originY + b[1] * scale);
          }
        }
        ctx.stroke();
      }
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
    }
    if (L) {
      for (let x = L.x0; x <= L.x1; x++) {
        for (let y = L.y0; y <= L.y1; y++) requestTile(L.zi, wrapX(x, L.n), y);
      }
    }

    // Mark the fitted box: four corner dots and one at its centre, so the
    // fitted region is visible on the base map.
    for (const [mx, my] of boundsMerc) {
      drawDot(width / 2 + (mx - centerMx) * scale, height / 2 + (my - centerMy) * scale, 6, CORNER);
    }
    const midX = (boundsMerc[0][0] + boundsMerc[2][0]) / 2;
    const midY = (boundsMerc[0][1] + boundsMerc[2][1]) / 2;
    drawDot(width / 2 + (midX - centerMx) * scale, height / 2 + (midY - centerMy) * scale, 5, CENTRE);

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
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
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
      zoom + (e.deltaY < 0 ? 0.25 : -0.25),
    );
  }, { passive: false });
  window.addEventListener('resize', resize);

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

  resize();
  void loadBase();

  return {
    canvas,
    ctx,
    get center(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom() {
      return zoom;
    },
    bounds: BOUNDS,
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    fitBounds,
    getScreenPos,
    baseReady: readyTiles,
    baseVisible(): number {
      const L = baseLayout();
      return L ? (L.x1 - L.x0 + 1) * (L.y1 - L.y0 + 1) : 0;
    },
    baseLoaded(): boolean {
      return tileJson !== null;
    },
    resetView(): void {
      centerMx = defaultCenterMx;
      centerMy = defaultCenterMy;
      zoom = START_ZOOM;
      draw();
    },
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
