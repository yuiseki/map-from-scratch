export interface PulsingDotMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  phase(): number;
  animating(): boolean;
  setPhase(t: number): void;
  resume(): void;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  resetView(): void;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

// Mapbox "Add an image (animated)": a pulsing dot drawn as a 200 px symbol
// image at pixelRatio 2 (100 CSS px) on a world map.
const DOT_LNG = 0;
const DOT_LAT = 0;
const DEFAULT_ZOOM = 2;
const DURATION_MS = 1000;

const ICON_CSS = 100; // 200 px image at pixelRatio 2
// Radii in CSS pixels: half of the 200 px image is 100 image px, i.e. 50 CSS px.
const INNER_R = (ICON_CSS / 2) * 0.3;
const OUTER_GROWTH = (ICON_CSS / 2) * 0.7;

const OCEAN = '#aad3df';
const LAND = '#f0eee8';
const LAND_EDGE = '#d0cdc4';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(DOT_LNG);
const defaultCenterMy = mercY(DOT_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<PulsingDotMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = DEFAULT_ZOOM;
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  let lastPhase = 0;
  let running = true;
  let rafId = 0;

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

  function drawDot(): void {
    const [cx, cy] = getScreenPos(DOT_LNG, DOT_LAT);
    const t = lastPhase;
    const outer = INNER_R + OUTER_GROWTH * t;

    ctx.beginPath();
    ctx.arc(cx, cy, outer, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 200, 200, ${1 - t})`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, INNER_R, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 100, 100, 1)';
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1 + 2 * (1 - t);
    ctx.fill();
    ctx.stroke();
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

    drawDot();
    ctx.restore();
  }

  function frame(): void {
    if (!running) return;
    lastPhase = (performance.now() % DURATION_MS) / DURATION_MS;
    draw();
    rafId = requestAnimationFrame(frame);
  }

  function setPhase(t: number): void {
    running = false;
    cancelAnimationFrame(rafId);
    lastPhase = Math.min(1, Math.max(0, t));
    draw();
  }

  function resume(): void {
    if (running) return;
    running = true;
    frame();
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
      zoom + (e.deltaY < 0 ? 0.5 : -0.5),
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
    zoom = Math.max(1, Math.min(12, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = DEFAULT_ZOOM;
    draw();
  }

  resize();
  requestAnimationFrame(frame);

  return {
    canvas,
    ctx,
    get center(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom() {
      return zoom;
    },
    phase: () => lastPhase,
    animating: () => running,
    setPhase,
    resume,
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    resetView,
    destroy(): void {
      running = false;
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', resize);
    },
  };
}
