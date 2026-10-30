export interface AnimatePointMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  advance(ms: number): void;
  resetAngle(): void;
  setAnimating(on: boolean): void;
  getPointScreenPos(): [number, number];
  getPointLngLat(): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

// The MapLibre example orbits a point around [0, 0] on a 20-degree radius.
const CENTER_LNG = 0;
const CENTER_LAT = 0;
const RADIUS_DEG = 20;
const SPEED_DEG_PER_S = 60;
const DOT_R = 9;

const mercX = (lon: number) => (lon + 180) / 360;
const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const centerMx0 = mercX(CENTER_LNG);
const centerMy0 = mercY(CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<AnimatePointMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('2D context not available');

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = centerMx0;
  let centerMy = centerMy0;
  let zoom = 4;
  let angle = 0;
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

  function pointLngLat(): [number, number] {
    return [Math.cos(angle) * RADIUS_DEG, Math.sin(angle) * RADIUS_DEG];
  }

  function getPointScreenPos(): [number, number] {
    const [lng, lat] = pointLngLat();
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (mercX(lng) - centerMx) * scale,
      height / 2 + (mercY(lat) - centerMy) * scale,
    ];
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

    // The animated point: a blue dot with a white ring (the example's circle layer).
    const [px, py] = getPointScreenPos();
    ctx.beginPath();
    ctx.arc(px, py, DOT_R, 0, Math.PI * 2);
    ctx.fillStyle = '#007cbf';
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
    angle += (dt / 1000) * (SPEED_DEG_PER_S * Math.PI / 180);
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
    }
  }

  function advance(ms: number): void {
    angle += (ms / 1000) * (SPEED_DEG_PER_S * Math.PI / 180);
    draw();
  }

  function resetAngle(): void {
    angle = 0;
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
    zoom = Math.max(1, Math.min(18, z));
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
    resetAngle,
    setAnimating,
    getPointScreenPos,
    getPointLngLat: pointLngLat,
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
