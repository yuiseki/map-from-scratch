export type Corner = 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right';

export interface AttributionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AttributionMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  position: Corner;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  setPosition(p: Corner): void;
  resetView(): void;
  getAttributionRect(): AttributionRect;
  getScreenPos(lon: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const CENTER_LNG = -96.0;
const CENTER_LAT = 37.8;
const MARGIN = 12;
const BOX_W = 222;
const BOX_H = 28;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<AttributionMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 3;
  let position: Corner = 'bottom-left';
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

  function getAttributionRect(): AttributionRect {
    const x = position.endsWith('left') ? MARGIN : width - BOX_W - MARGIN;
    const y = position.startsWith('top') ? MARGIN : height - BOX_H - MARGIN;
    return { x, y, width: BOX_W, height: BOX_H };
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

    // Attribution chrome: screen-anchored, so it does not move with the map.
    const b = getAttributionRect();
    const r = 4;
    ctx.beginPath();
    ctx.moveTo(b.x + r, b.y);
    ctx.lineTo(b.x + b.width - r, b.y);
    ctx.arcTo(b.x + b.width, b.y, b.x + b.width, b.y + r, r);
    ctx.lineTo(b.x + b.width, b.y + b.height - r);
    ctx.arcTo(b.x + b.width, b.y + b.height, b.x + b.width - r, b.y + b.height, r);
    ctx.lineTo(b.x + r, b.y + b.height);
    ctx.arcTo(b.x, b.y + b.height, b.x, b.y + b.height - r, r);
    ctx.lineTo(b.x, b.y + r);
    ctx.arcTo(b.x, b.y, b.x + r, b.y, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
    ctx.fill();

    ctx.fillStyle = '#333333';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('© OpenStreetMap contributors', b.x + 10, b.y + b.height / 2);

    ctx.restore();
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

  function setPosition(p: Corner): void {
    position = p;
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = 3;
    position = 'bottom-left';
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
    get position() { return position; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    setPosition,
    resetView,
    getAttributionRect,
    getScreenPos,
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
