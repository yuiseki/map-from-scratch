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

  // Camera state
  let cx = 0; // lon
  let cy = 20; // lat
  let zoom = 1.2;

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

  function mercX(lon: number): number {
    return (lon + 180) / 360;
  }
  function mercY(lat: number): number {
    const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
    return 0.5 - (0.25 * Math.log((1 + s) / (1 - s))) / Math.PI;
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;

    // Ocean background
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, w, h);

    const zi = Math.max(0, Math.min(2, Math.floor(zoom)));
    const n = 1 << zi;
    const scale = (256 * Math.pow(2, zoom)) / n;

    const mx = mercX(cx);
    const my = mercY(cy);

    const screenCenterX = w / 2;
    const screenCenterY = h / 2;

    // Render tiles
    for (let x = 0; x < n; x++) {
      for (let y = 0; y < n; y++) {
        // Tile top-left in screen coords
        const tileLeft = screenCenterX + (x / n - mx) * (256 * Math.pow(2, zoom));
        const tileTop = screenCenterY + (y / n - my) * (256 * Math.pow(2, zoom));
        const tileSize = scale;

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
          ctx.beginPath();
          ctx.moveTo(tileLeft + ring[0] * tileSize, tileTop + ring[1] * tileSize);
          for (let i = 2; i < ring.length; i += 2) {
            ctx.lineTo(tileLeft + ring[i] * tileSize, tileTop + ring[i + 1] * tileSize);
          }
          ctx.closePath();
          ctx.fill();
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
    const worldSize = 256 * Math.pow(2, zoom);
    cx -= (dx / worldSize) * 360;
    cy += (dy / worldSize) * 180;
    cy = Math.max(-80, Math.min(80, cy));
    lastX = e.clientX;
    lastY = e.clientY;
    render();
  });

  const stopDrag = (e: PointerEvent) => {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  };
  canvas.addEventListener('pointerup', stopDrag);
  canvas.addEventListener('pointercancel', stopDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(0.5, Math.min(2.8, zoom - e.deltaY * 0.002));
    render();
  }, { passive: false });

  // Initial draw
  render();

  const mapInstance: OpfsMap = {
    canvas,
    ctx,
    render,
    panBy(dx: number, dy: number) {
      const worldSize = 256 * Math.pow(2, zoom);
      cx -= (dx / worldSize) * 360;
      cy += (dy / worldSize) * 180;
      cy = Math.max(-80, Math.min(80, cy));
      render();
    },
    zoomBy(delta: number) {
      zoom = Math.max(0.5, Math.min(2.8, zoom + delta));
      render();
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
