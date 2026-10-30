// examples/tangram/008-road-filters-demo/map.ts

export interface RoadFeature {
  n: string; // name
  t: number; // 0: Interstate, 1: US Highway, 2: State Route
  p: number[]; // [mx0, my0, mx1, my1, ...]
}

export interface TangramRoadMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  roadCount: number;
  visibleRoadCount: number;
  render: () => void;
  panBy: (dx: number, dy: number) => void;
  setZoom: (z: number) => void;
  setFilters: (opts: { interstate?: boolean; usHighway?: boolean; stateRoute?: boolean; search?: string }) => void;
  getScreenPos: (lon: number, lat: number) => [number, number];
}

function projectMercator(lon: number, lat: number): [number, number] {
  const x = (lon + 180) / 360;
  const sin = Math.sin((lat * Math.PI) / 180);
  const clampedSin = Math.max(-0.9999, Math.min(0.9999, sin));
  const y = 0.5 - Math.log((1 + clampedSin) / (1 - clampedSin)) / (4 * Math.PI);
  return [x, y];
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<TangramRoadMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('Failed to get 2D context');

  const res = await fetch(dataUrl);
  if (!res.ok) throw new Error(`Failed to load road data: ${res.status}`);
  const data = await res.json();
  const landRings: number[][] = data.land || [];
  const roads: RoadFeature[] = data.roads || [];

  // Filter state
  let showInterstate = true;
  let showUSHighway = true;
  let showStateRoute = true;
  let searchQuery = '';

  // Initial camera: San Francisco Bay Area (-122.25, 37.82), zoom 7.8
  const [initMx, initMy] = projectMercator(-122.25, 37.82);
  let centerMx = initMx;
  let centerMy = initMy;
  let zoom = 7.8;

  let width = canvas.clientWidth || 1024;
  let height = canvas.clientHeight || 768;
  let dpr = window.devicePixelRatio || 1;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 1024;
    height = canvas.clientHeight || 768;
    const targetW = Math.round(width * dpr);
    const targetH = Math.round(height * dpr);
    if (canvas.width !== targetW || canvas.height !== targetH) {
      canvas.width = targetW;
      canvas.height = targetH;
    }
  }
  resize();
  window.addEventListener('resize', () => { resize(); render(); });

  let visibleCount = 0;

  function render() {
    const w = canvas.width;
    const h = canvas.height;
    const scale = 256 * Math.pow(2, zoom) * dpr;

    const toScreenX = (mx: number) => (mx - centerMx) * scale + w / 2;
    const toScreenY = (my: number) => (my - centerMy) * scale + h / 2;

    // 1. Dark ocean background
    ctx.fillStyle = '#101524';
    ctx.fillRect(0, 0, w, h);

    // 2. Landmasses
    ctx.beginPath();
    for (const ring of landRings) {
      const len = ring.length;
      if (len < 4) continue;
      ctx.moveTo(toScreenX(ring[0]), toScreenY(ring[1]));
      for (let i = 2; i < len; i += 2) {
        ctx.lineTo(toScreenX(ring[i]), toScreenY(ring[i + 1]));
      }
      ctx.closePath();
    }
    ctx.fillStyle = '#1a2236';
    ctx.fill();

    // 3. Filter roads into 3 class buckets
    const iRoads: RoadFeature[] = [];
    const usRoads: RoadFeature[] = [];
    const srRoads: RoadFeature[] = [];

    const normSearch = searchQuery.trim().toLowerCase();

    for (const r of roads) {
      if (r.t === 0 && !showInterstate) continue;
      if (r.t === 1 && !showUSHighway) continue;
      if (r.t === 2 && !showStateRoute) continue;

      if (normSearch.length > 0 && !r.n.toLowerCase().includes(normSearch)) {
        continue;
      }

      if (r.t === 0) iRoads.push(r);
      else if (r.t === 1) usRoads.push(r);
      else srRoads.push(r);
    }

    visibleCount = iRoads.length + usRoads.length + srRoads.length;

    // Viewport bounds for culling
    const minX = -50;
    const maxX = w + 50;
    const minY = -50;
    const maxY = h + 50;

    // Helper to draw a bucket of roads
    function drawBucket(bucket: RoadFeature[], color: string, lineWidth: number) {
      if (bucket.length === 0) return;
      ctx.beginPath();
      for (const road of bucket) {
        const pts = road.p;
        const len = pts.length;
        if (len < 4) continue;

        let started = false;
        for (let i = 0; i < len; i += 2) {
          const sx = toScreenX(pts[i]);
          const sy = toScreenY(pts[i + 1]);
          if (!started) {
            ctx.moveTo(sx, sy);
            started = true;
          } else {
            ctx.lineTo(sx, sy);
          }
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }

    // 4. Render roads: lower priority first, so Interstates are on top
    // State Routes (sky-blue)
    drawBucket(srRoads, '#48cae4', 1.2 * dpr);

    // US Highways (amber/yellow)
    drawBucket(usRoads, '#ffb703', 2.0 * dpr);

    // Interstates: casing then core (cyan glow)
    if (iRoads.length > 0) {
      drawBucket(iRoads, '#005f73', 4.5 * dpr); // subtle dark halo casing
      drawBucket(iRoads, '#00f0ff', 2.6 * dpr); // vibrant cyan core
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
    const scale = 256 * Math.pow(2, zoom) * dpr;
    const dx = (e.clientX - lastX) * dpr;
    const dy = (e.clientY - lastY) * dpr;
    centerMx -= dx / scale;
    centerMy -= dy / scale;
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

  // Wheel zoom centered on pointer
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const ox = (e.clientX - r.left - r.width / 2) * dpr;
    const oy = (e.clientY - r.top - r.height / 2) * dpr;
    const before = 256 * Math.pow(2, zoom) * dpr;
    centerMx += ox / before;
    centerMy += oy / before;

    const zoomDelta = -e.deltaY * 0.002;
    zoom = Math.max(3.0, Math.min(14.0, zoom + zoomDelta));

    const after = 256 * Math.pow(2, zoom) * dpr;
    centerMx -= ox / after;
    centerMy -= oy / after;
    render();
  }, { passive: false });

  // Initial draw
  render();

  return {
    canvas,
    ctx,
    roadCount: roads.length,
    get visibleRoadCount() { return visibleCount; },
    render,
    panBy(dx: number, dy: number) {
      const scale = 256 * Math.pow(2, zoom) * dpr;
      centerMx -= (dx * dpr) / scale;
      centerMy -= (dy * dpr) / scale;
      render();
    },
    setZoom(z: number) {
      zoom = z;
      render();
    },
    setFilters(opts) {
      if (opts.interstate !== undefined) showInterstate = opts.interstate;
      if (opts.usHighway !== undefined) showUSHighway = opts.usHighway;
      if (opts.stateRoute !== undefined) showStateRoute = opts.stateRoute;
      if (opts.search !== undefined) searchQuery = opts.search;
      render();
    },
    getScreenPos(lon: number, lat: number) {
      const [mx, my] = projectMercator(lon, lat);
      const scale = 256 * Math.pow(2, zoom) * dpr;
      const w = canvas.width;
      const h = canvas.height;
      return [(mx - centerMx) * scale + w / 2, (my - centerMy) * scale + h / 2];
    }
  };
}
