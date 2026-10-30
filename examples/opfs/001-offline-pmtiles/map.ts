// examples/opfs/001-offline-pmtiles/map.ts

export interface OpfsMapStats {
  totalSyncReads: number;
  avgLatencyMs: number;
  opfsSize: number;
  networkRequests: number;
  cachedTiles: number;
}

export interface OpfsMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  render: () => void;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (delta: number) => void;
  worldPx: () => number;
  getStats: () => Promise<OpfsMapStats>;
  readPixel: (x: number, y: number) => Uint8ClampedArray;
  onTileLoaded?: () => void;
}

interface TileData {
  rings: Float32Array[];
}

export async function mount(canvas: HTMLCanvasElement, archiveUrl: string): Promise<OpfsMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  if (!ctx) throw new Error('Failed to get 2D canvas context');

  let networkRequests = 0;
  // Track network fetches in main thread if any
  const origFetch = window.fetch;
  window.fetch = async (...args) => {
    networkRequests++;
    return origFetch(...args);
  };

  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

  // Camera state: the centre in Web Mercator units (0..1 across one world)
  let mx = 0.5;
  let my = 0.5 - Math.log(Math.tan(Math.PI / 4 + (20 * Math.PI) / 360)) / (2 * Math.PI); // 20° N
  let zoom = 1.2;

  // The backing store follows the element's CSS size, so tiles stay square.
  let dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  resize();

  const tileCache = new Map<string, TileData>();
  let inFlight = new Set<string>();

  let opfsStats: OpfsMapStats = {
    totalSyncReads: 0,
    avgLatencyMs: 0,
    opfsSize: 0,
    networkRequests: 0,
    cachedTiles: 0,
  };

  let tileIdCounter = 0;
  const pendingRequests = new Map<number, (rings: Float32Array[]) => void>();

  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === 'tile') {
      const key = `${msg.z}/${msg.x}/${msg.y}`;
      inFlight.delete(key);
      tileCache.set(key, { rings: msg.rings });
      if (pendingRequests.has(msg.id)) {
        pendingRequests.get(msg.id)!(msg.rings);
        pendingRequests.delete(msg.id);
      }
      render();
      if (mapInstance.onTileLoaded) mapInstance.onTileLoaded();
    } else if (msg.type === 'stats') {
      opfsStats.totalSyncReads = msg.totalSyncReads;
      opfsStats.avgLatencyMs = msg.avgLatencyMs;
      opfsStats.opfsSize = msg.opfsSize;
      opfsStats.cachedTiles = tileCache.size;
      opfsStats.networkRequests = networkRequests;
    }
  };

  // Wait for worker OPFS initialization
  await new Promise<void>((resolve, reject) => {
    const handler = (e: MessageEvent) => {
      if (e.data.type === 'ready') {
        opfsStats.opfsSize = e.data.opfsSize;
        resolve();
      } else if (e.data.type === 'error') {
        reject(new Error(e.data.message));
      }
    };
    worker.addEventListener('message', handler, { once: true });
    worker.postMessage({ type: 'init', archiveUrl });
  });

  function render() {
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Ocean background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const zi = Math.max(0, Math.min(2, Math.floor(zoom)));
    const n = 1 << zi;
    const world = 256 * Math.pow(2, zoom);
    const tileSize = world / n;

    // Every world copy that touches the screen, east and west.
    const k0 = Math.floor(mx - w / 2 / world), k1 = Math.floor(mx + w / 2 / world);
    for (let k = k0; k <= k1; k++)
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        // Tile top-left in screen coords
        const tileLeft = w / 2 + (k + x / n - mx) * world;
        const tileTop = h / 2 + (y / n - my) * world;

        // Culling
        if (tileLeft + tileSize < 0 || tileLeft > w || tileTop + tileSize < 0 || tileTop > h) {
          continue;
        }

        const key = `${zi}/${x}/${y}`;
        const cached = tileCache.get(key);

        if (!cached) {
          if (!inFlight.has(key)) {
            inFlight.add(key);
            const reqId = ++tileIdCounter;
            worker.postMessage({ type: 'getTile', id: reqId, z: zi, x, y });
          }
          continue;
        }

        // Draw tile land polygons
        ctx.save();
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1;

        for (const ring of cached.rings) {
          if (ring.length < 6) continue;
          const X = (i: number) => tileLeft + ring[i] * tileSize, Y = (i: number) => tileTop + ring[i + 1] * tileSize;
          ctx.beginPath();
          ctx.moveTo(X(0), Y(0));
          for (let i = 2; i < ring.length; i += 2) ctx.lineTo(X(i), Y(i));
          ctx.closePath();
          ctx.fill();
          // Stroke the coast only: an edge lying on the tile border is where
          // the bake clipped the polygon, not a shore.
          ctx.beginPath();
          const m = ring.length;
          for (let i = 0; i < m; i += 2) {
            const j = (i + 2) % m, ax = ring[i], ay = ring[i + 1], bx = ring[j], by = ring[j + 1];
            const cut = (ax === bx && (ax <= 0 || ax >= 1)) || (ay === by && (ay <= 0 || ay >= 1));
            if (!cut) { ctx.moveTo(X(i), Y(i)); ctx.lineTo(X(j), Y(j)); }
          }
          ctx.stroke();
        }

        // Tile boundary
        ctx.strokeStyle = 'rgba(71, 85, 105, 0.2)';
        ctx.strokeRect(tileLeft, tileTop, tileSize, tileSize);
        ctx.restore();
      }
    }
  }

  // Pointer drag interaction
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

  const stopDrag = (e: PointerEvent) => {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  function panBy(dx: number, dy: number) {
    const world = 256 * Math.pow(2, zoom);
    mx -= dx / world;
    mx -= Math.floor(mx);
    my = Math.max(0, Math.min(1, my - dy / world));
    render();
  }

  // Zoom about (px, py) in CSS px: the point under it stays put.
  function zoomAt(z: number, px: number, py: number) {
    const ox = px - canvas.width / dpr / 2, oy = py - canvas.height / dpr / 2;
    const before = 256 * Math.pow(2, zoom);
    zoom = Math.max(0.5, Math.min(2.8, z));
    const after = 256 * Math.pow(2, zoom);
    mx += ox / before - ox / after;
    my = Math.max(0, Math.min(1, my + oy / before - oy / after));
    render();
  }

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(zoom - e.deltaY * 0.002, e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });

  // Initial draw. Nothing may ask the worker for tiles before it is ready:
  // the 'ready' listener above takes the first message it gets.
  window.addEventListener('resize', () => { resize(); render(); });
  render();

  const mapInstance: OpfsMap = {
    canvas,
    ctx,
    render,
    panBy,
    worldPx: () => 256 * Math.pow(2, zoom),
    zoomBy(delta: number) {
      zoomAt(zoom + delta, canvas.width / dpr / 2, canvas.height / dpr / 2);
    },
    async getStats(): Promise<OpfsMapStats> {
      return new Promise((resolve) => {
        const handler = (e: MessageEvent) => {
          if (e.data.type === 'stats') {
            worker.removeEventListener('message', handler);
            resolve({
              totalSyncReads: e.data.totalSyncReads,
              avgLatencyMs: e.data.avgLatencyMs,
              opfsSize: e.data.opfsSize,
              networkRequests,
              cachedTiles: tileCache.size,
            });
          }
        };
        worker.addEventListener('message', handler);
        worker.postMessage({ type: 'getStats' });
      });
    },
    readPixel(x: number, y: number): Uint8ClampedArray {
      return ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data;
    },
  };

  return mapInstance;
}
