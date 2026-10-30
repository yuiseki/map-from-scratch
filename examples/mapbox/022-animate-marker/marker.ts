export interface BouncingMarkerMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  advance(ms: number): void;
  resetAnimation(): void;
  setAnimating(on: boolean): void;
  getMarkerScreenPos(): [number, number];
  getAnchorScreenPos(): [number, number];
  getBouncePx(): number;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

// A marker that hops up and comes back down once a second, like the Mapbox
// example's startAnimation() loop with a sine-eased offset.
const MARKER_LNG = -96.0;
const MARKER_LAT = 37.8;
const BOUNCE_AMP = 26;
const BOUNCE_MS = 700;
const PIN_W = 26;
const PIN_H = 38;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const anchorMx = mercX(MARKER_LNG);
const anchorMy = mercY(MARKER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<BouncingMarkerMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = anchorMx;
  let centerMy = anchorMy;
  let zoom = 3;
  let elapsedMs = 0;
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

  function bouncePx(): number {
    const u = (elapsedMs % BOUNCE_MS) / BOUNCE_MS;
    return BOUNCE_AMP * Math.abs(Math.sin(Math.PI * u));
  }

  function getAnchorScreenPos(): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (anchorMx - centerMx) * scale,
      height / 2 + (anchorMy - centerMy) * scale,
    ];
  }

  function getMarkerScreenPos(): [number, number] {
    const [ax, ay] = getAnchorScreenPos();
    return [ax, ay - bouncePx()];
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
        ctx.stroke();
      }
    }

    // A faint shadow at the anchor so the hop height reads on screen.
    const [ax, ay] = getAnchorScreenPos();
    ctx.beginPath();
    ctx.ellipse(ax, ay, 8, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
    ctx.fill();

    // The hopping pin, tip anchored at the marker coordinate plus the bounce.
    const [mx, my] = getMarkerScreenPos();
    const headY = my - PIN_H + 10;
    ctx.beginPath();
    ctx.arc(mx, headY, 9, 0, Math.PI * 2);
    ctx.moveTo(mx - 7, headY + 7);
    ctx.lineTo(mx + 7, headY + 7);
    ctx.lineTo(mx, my);
    ctx.closePath();
    ctx.fillStyle = '#e8590c';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.restore();
  }

  let animating = false;
  let rafId = 0;
  let lastTime = 0;

  function tick(now: number): void {
    const dt = Math.min(100, now - lastTime);
    lastTime = now;
    elapsedMs += dt;
    draw();
    rafId = requestAnimationFrame(tick);
  }

  function setAnimating(on: boolean): void {
    if (on === animating) return;
    animating = on;
    if (on) {
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function advance(ms: number): void {
    elapsedMs += ms;
    draw();
  }

  function resetAnimation(): void {
    elapsedMs = 0;
    draw();
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
    zoom = Math.max(1, Math.min(10, z));
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
  setAnimating(true);

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    advance,
    resetAnimation,
    setAnimating,
    getMarkerScreenPos,
    getAnchorScreenPos,
    getBouncePx: bouncePx,
    destroy() {
      setAnimating(false);
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
