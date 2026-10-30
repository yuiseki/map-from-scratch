export interface SymbolCentreMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  getSymbolScreenPos(i: number): [number, number];
  isAnimating(): boolean;
  advance(ms: number): void;
  setAnimating(on: boolean): void;
  resetView(): void;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

interface City {
  name: string;
  lng: number;
  lat: number;
  color: string;
}

const CITIES: City[] = [
  { name: 'New York', lng: -74.0, lat: 40.7, color: '#d9480f' },
  { name: 'London', lng: -0.12, lat: 51.5, color: '#1b8a3a' },
  { name: 'Tokyo', lng: 139.7, lat: 35.7, color: '#b3125c' },
];

const DEFAULT_LNG = 40;
const DEFAULT_LAT = 40;
const DEFAULT_ZOOM = 2.5;
const ANIM_MS = 600;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(DEFAULT_LNG);
const defaultCenterMy = mercY(DEFAULT_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<SymbolCentreMap> {
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

  interface Tween {
    fromMx: number; fromMy: number;
    toMx: number; toMy: number;
    elapsed: number;
  }
  let tween: Tween | null = null;
  let animating = true;
  let rafId = 0;
  let lastTime = 0;

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

  function getSymbolScreenPos(i: number): [number, number] {
    return getScreenPos(CITIES[i].lng, CITIES[i].lat);
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#aad3df';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = '#f0eee8';
    ctx.strokeStyle = '#d0cdc4';
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

    // Clickable pins: a round head joined to a tip at the city coordinate.
    for (const city of CITIES) {
      const [sx, sy] = getScreenPos(city.lng, city.lat);
      ctx.beginPath();
      ctx.arc(sx, sy - 18, 8, 0, Math.PI * 2);
      ctx.moveTo(sx - 6, sy - 14);
      ctx.lineTo(sx + 6, sy - 14);
      ctx.lineTo(sx, sy);
      ctx.closePath();
      ctx.fillStyle = city.color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }

    ctx.restore();
  }

  function step(ms: number): void {
    if (!tween) return;
    tween.elapsed = Math.min(ANIM_MS, tween.elapsed + ms);
    const u = tween.elapsed / ANIM_MS;
    const e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) * (-2 * u + 2) / 2;
    centerMx = tween.fromMx + (tween.toMx - tween.fromMx) * e;
    centerMy = tween.fromMy + (tween.toMy - tween.fromMy) * e;
    if (u >= 1) tween = null;
    draw();
  }

  function advance(ms: number): void {
    step(ms);
  }

  function loop(t: number): void {
    rafId = 0;
    if (!animating) return;
    if (tween) {
      step(t - lastTime);
      if (tween) rafId = requestAnimationFrame(loop);
    }
    lastTime = t;
  }

  function setAnimating(on: boolean): void {
    animating = on;
    if (on && tween && !rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
    if (!on && rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function flyTo(lng: number, lat: number): void {
    tween = {
      fromMx: centerMx, fromMy: centerMy,
      toMx: mercX(lng), toMy: mercY(lat),
      elapsed: 0,
    };
    if (animating && !rafId) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(loop);
    }
  }

  let dragging = false;
  let didDrag = false;
  let downX = 0;
  let downY = 0;
  let lastX = 0;
  let lastY = 0;

  function localPoint(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function hitsSymbol(x: number, y: number): number {
    for (let i = 0; i < CITIES.length; i++) {
      const [sx, sy] = getSymbolScreenPos(i);
      if (Math.abs(x - sx) <= 12 && y >= sy - 30 && y <= sy + 4) return i;
    }
    return -1;
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    didDrag = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) didDrag = true;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
    if (didDrag) return;
    const [x, y] = localPoint(e);
    const i = hitsSymbol(x, y);
    if (i >= 0) flyTo(CITIES[i].lng, CITIES[i].lat);
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
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
  }

  function panBy(dx: number, dy: number): void {
    tween = null;
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(1, Math.min(10, z));
    draw();
  }

  function resetView(): void {
    tween = null;
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = DEFAULT_ZOOM;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

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
    getSymbolScreenPos,
    isAnimating: () => tween !== null,
    advance,
    setAnimating,
    resetView,
    destroy() {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
