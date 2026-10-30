// examples/wasm/001-jspi-range-reader/map.ts
// Interactive map powered by synchronous C PMTiles v3 reader compiled with WebAssembly JSPI.

declare global {
  interface Window {
    Module?: any;
    __pmtiles_url?: string;
    __jspi_range_reads?: number;
    __jspi_range_bytes?: number;
  }
}

export interface HeaderInfo {
  version: number;
  minZoom: number;
  maxZoom: number;
  numEntries: number;
  totalReads: number;
  totalBytes: number;
}

export interface JspiMap {
  canvas: HTMLCanvasElement;
  headerInfo: HeaderInfo;
  getTileCount: () => number;
  getRangeReadCount: () => number;
  getRangeBytes: () => number;
  panBy: (dx: number, dy: number) => void;
  zoomBy: (delta: number) => void;
  render: () => void;
  readPixel: (x: number, y: number) => Uint8Array;
}

interface TileRings {
  rings: Float32Array[];
}

export async function mount(canvas: HTMLCanvasElement, archiveUrl: string): Promise<JspiMap> {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get Canvas 2D context');
  const context = ctx;

  // Load Emscripten JS glue if not already loaded
  if (!window.Module || !window.Module._init_reader) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './reader.js';
      script.onload = () => {
        if (window.Module && window.Module.calledRun) {
          resolve();
        } else {
          window.Module = window.Module || {};
          const prev = window.Module.onRuntimeInitialized;
          window.Module.onRuntimeInitialized = () => {
            if (prev) prev();
            resolve();
          };
        }
      };
      script.onerror = () => reject(new Error('Failed to load reader.js'));
      document.head.appendChild(script);
    });
  }

  const Module = window.Module;

  // Bind exported C functions via cwrap
  const cInitReader = Module.cwrap('init_reader', 'number', ['string'], { async: true });
  const cGetTile = Module.cwrap('get_tile', 'number', ['number', 'number', 'number'], { async: true });
  const cGetTileSize = Module.cwrap('get_tile_size', 'number', []);
  const cGetHeaderInfo = Module.cwrap('get_header_info', null, ['number']);

  // 1. Initialize synchronous C reader (suspends via JSPI during HTTP Range fetches)
  const numEntries = await cInitReader(archiveUrl);
  if (numEntries < 0) {
    throw new Error(`Failed to initialize PMTiles reader: code ${numEntries}`);
  }

  // Read header metadata from C
  const infoPtr = Module._malloc(24);
  cGetHeaderInfo(infoPtr);
  const infoDv = new DataView(Module.HEAPU8.buffer, infoPtr, 24);
  const headerInfo: HeaderInfo = {
    version: infoDv.getUint32(0, true),
    minZoom: infoDv.getUint32(4, true),
    maxZoom: infoDv.getUint32(8, true),
    numEntries: infoDv.getUint32(12, true),
    totalReads: infoDv.getUint32(16, true),
    totalBytes: infoDv.getUint32(20, true),
  };
  Module._free(infoPtr);

  // Tile cache
  const tileCache = new Map<string, TileRings>();
  const inFlight = new Set<string>();

  // Camera state: Mercator center (0.5, 0.5), initial zoom 0.9
  let cx = 0.5;
  let cy = 0.5;
  let zoom = 0.9;
  const dpr = window.devicePixelRatio || 1;

  function resize() {
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
  }
  resize();

  async function fetchTile(z: number, x: number, y: number): Promise<TileRings | null> {
    const key = `${z}/${x}/${y}`;
    if (tileCache.has(key)) return tileCache.get(key)!;
    if (inFlight.has(key)) return null;

    inFlight.add(key);
    try {
      // Synchronous C function call (suspends JSPI while browser fetches Range)
      const ptr = await cGetTile(z, x, y);
      const size = cGetTileSize();

      if (!ptr || size === 0) {
        tileCache.set(key, { rings: [] });
        return { rings: [] };
      }

      // Parse custom tile payload: [numRings: u16, [numPoints: u16, [x, y]*numPoints]...]
      const dv = new DataView(Module.HEAPU8.buffer, ptr, size);
      const numRings = dv.getUint16(0, true);
      const rings: Float32Array[] = [];
      let offset = 2;

      for (let r = 0; r < numRings; r++) {
        if (offset + 2 > size) break;
        const numPoints = dv.getUint16(offset, true);
        offset += 2;
        const ring = new Float32Array(numPoints * 2);
        for (let p = 0; p < numPoints; p++) {
          if (offset + 4 > size) break;
          const lx = dv.getUint16(offset, true) / 4096;
          const ly = dv.getUint16(offset + 2, true) / 4096;
          offset += 4;
          ring[p * 2] = lx;
          ring[p * 2 + 1] = ly;
        }
        rings.push(ring);
      }

      const res: TileRings = { rings };
      tileCache.set(key, res);
      return res;
    } finally {
      inFlight.delete(key);
    }
  }

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    context.clearRect(0, 0, w, h);

    // Ocean background
    context.fillStyle = '#0f172a'; // slate-900
    context.fillRect(0, 0, w, h);

    const z = Math.max(0, Math.min(2, Math.floor(zoom)));
    const numTiles = 1 << z;
    const tileSize = 256 * Math.pow(2, zoom - z) * dpr;
    const worldSize = tileSize * numTiles;

    const screenCenterX = w / 2;
    const screenCenterY = h / 2;

    const worldOriginX = screenCenterX - cx * worldSize;
    const worldOriginY = screenCenterY - cy * worldSize;

    // Determine visible tile range
    const minTileX = Math.floor(-worldOriginX / tileSize);
    const maxTileX = Math.floor((w - worldOriginX) / tileSize);
    const minTileY = Math.max(0, Math.floor(-worldOriginY / tileSize));
    const maxTileY = Math.min(numTiles - 1, Math.floor((h - worldOriginY) / tileSize));

    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        const wrappedX = ((tx % numTiles) + numTiles) % numTiles;
        const tileLeft = worldOriginX + tx * tileSize;
        const tileTop = worldOriginY + ty * tileSize;

        const key = `${z}/${wrappedX}/${ty}`;
        const cached = tileCache.get(key);

        if (!cached) {
          fetchTile(z, wrappedX, ty).then(t => {
            if (t) render();
          });
          continue;
        }

        context.save();
        context.fillStyle = '#334155'; // slate-700 land fill
        context.strokeStyle = '#38bdf8'; // sky-400 coast stroke
        context.lineWidth = 1.0 * dpr;

        for (const ring of cached.rings) {
          if (ring.length < 6) continue;
          context.beginPath();
          const p0X = tileLeft + ring[0] * tileSize;
          const p0Y = tileTop + ring[1] * tileSize;
          context.moveTo(p0X, p0Y);
          for (let i = 2; i < ring.length; i += 2) {
            context.lineTo(tileLeft + ring[i] * tileSize, tileTop + ring[i + 1] * tileSize);
          }
          context.closePath();
          context.fill();

          // Stroke only coastline (skip tile border edges)
          context.beginPath();
          const m = ring.length;
          for (let i = 0; i < m; i += 2) {
            const j = (i + 2) % m;
            const ax = ring[i];
            const ay = ring[i + 1];
            const bx = ring[j];
            const by = ring[j + 1];
            const isCut = (ax === bx && (ax <= 0 || ax >= 1)) || (ay === by && (ay <= 0 || ay >= 1));
            if (!isCut) {
              context.moveTo(tileLeft + ax * tileSize, tileTop + ay * tileSize);
              context.lineTo(tileLeft + bx * tileSize, tileTop + by * tileSize);
            }
          }
          context.stroke();
        }

        // Tile border guide
        context.strokeStyle = 'rgba(148, 163, 184, 0.15)';
        context.strokeRect(tileLeft, tileTop, tileSize, tileSize);
        context.restore();
      }
    }
  }

  // Pointer interactions
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

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? -0.15 : 0.15;
    zoomBy(factor);
  }, { passive: false });

  window.addEventListener('resize', () => {
    resize();
    render();
  });

  function panBy(dx: number, dy: number) {
    const worldSize = 256 * Math.pow(2, zoom) * dpr;
    cx -= dx * dpr / worldSize;
    cx -= Math.floor(cx);
    cy = Math.max(0.1, Math.min(0.9, cy - dy * dpr / worldSize));
    render();
  }

  function zoomBy(delta: number) {
    zoom = Math.max(0.2, Math.min(2.5, zoom + delta));
    render();
  }

  // Initial tile load for zoom 0
  await fetchTile(0, 0, 0);
  render();

  return {
    canvas,
    headerInfo,
    getTileCount() {
      return tileCache.size;
    },
    getRangeReadCount() {
      return window.__jspi_range_reads ?? 0;
    },
    getRangeBytes() {
      return window.__jspi_range_bytes ?? 0;
    },
    panBy,
    zoomBy,
    render,
    readPixel(x: number, y: number): Uint8Array {
      render();
      const px = context.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      return new Uint8Array(px);
    },
  };
}
