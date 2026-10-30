export interface DraggablePointMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getPointScreenPos(): [number, number];
  getPointLngLat(): [number, number];
  isDraggingPoint(): boolean;
  resetView(): void;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const POINT_R = 10;
const SPRITE = 24;
const HIT_R = 14;

const mercX = (lon: number): number => (lon + 180) / 360;
const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const invMercY = (my: number): number =>
  (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360) / Math.PI - 90;

const START_LNG = 0;
const START_LAT = 0;

function makePointSprite(scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(SPRITE * scale);
  c.height = Math.round(SPRITE * scale);
  const g = c.getContext('2d');
  if (!g) throw new Error('2D context not available');
  g.scale(scale, scale);
  g.beginPath();
  g.arc(SPRITE / 2, SPRITE / 2, POINT_R - 1, 0, Math.PI * 2);
  g.fillStyle = '#1e6fd9';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = '#ffffff';
  g.stroke();
  return c;
}

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<DraggablePointMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = mercX(START_LNG);
  let centerMy = mercY(START_LAT);
  let zoom = 3;
  let pointMx = centerMx;
  let pointMy = centerMy;
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  let sprite = makePointSprite(dpr);

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    sprite = makePointSprite(dpr);
    draw();
  }

  function getPointScreenPos(): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (pointMx - centerMx) * scale,
      height / 2 + (pointMy - centerMy) * scale,
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

    const [px, py] = getPointScreenPos();
    ctx.drawImage(sprite, px - SPRITE / 2, py - SPRITE / 2, SPRITE, SPRITE);

    ctx.restore();
  }

  let draggingPoint = false;
  let panning = false;
  let lastX = 0;
  let lastY = 0;
  let grabDX = 0;
  let grabDY = 0;

  function localPoint(e: { clientX: number; clientY: number }): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function hitsPoint(x: number, y: number): boolean {
    const [px, py] = getPointScreenPos();
    return Math.hypot(x - px, y - py) <= HIT_R;
  }

  function onPointerDown(e: PointerEvent): void {
    const [x, y] = localPoint(e);
    lastX = e.clientX;
    lastY = e.clientY;
    if (hitsPoint(x, y)) {
      draggingPoint = true;
      const [px, py] = getPointScreenPos();
      grabDX = px - x;
      grabDY = py - y;
    } else {
      panning = true;
    }
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    if (draggingPoint) {
      const [x, y] = localPoint(e);
      const scale = 256 * Math.pow(2, zoom);
      pointMx = centerMx + (x + grabDX - width / 2) / scale;
      pointMy = Math.max(0, Math.min(1, centerMy + (y + grabDY - height / 2) / scale));
      draw();
      return;
    }
    if (!panning) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    draggingPoint = false;
    panning = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
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
    const [x, y] = localPoint(e);
    zoomAtPoint(x, y, zoom + (e.deltaY < 0 ? 0.5 : -0.5));
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

  function resetView(): void {
    centerMx = mercX(START_LNG);
    centerMy = mercY(START_LAT);
    pointMx = centerMx;
    pointMy = centerMy;
    zoom = 3;
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

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getPointScreenPos,
    getPointLngLat: (): [number, number] => [pointMx * 360 - 180, invMercY(pointMy)],
    isDraggingPoint: () => draggingPoint,
    resetView,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
