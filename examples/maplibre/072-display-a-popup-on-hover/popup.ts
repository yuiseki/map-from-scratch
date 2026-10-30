export interface HoverPopupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HoverPopupMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  popupVisible: boolean;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  getMarkerScreenPos(): [number, number];
  getPopupBounds(): HoverPopupBounds;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const US_CENTER_LNG = -96.0;
const US_CENTER_LAT = 37.8;
const HOVER_RADIUS = 14;
const BUBBLE_W = 140;
const BUBBLE_H = 40;
const TIP_H = 8;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(US_CENTER_LNG);
const defaultCenterMy = mercY(US_CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<HoverPopupMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 3;
  let hovering = false;
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

  function getMarkerScreenPos(): [number, number] {
    return getScreenPos(US_CENTER_LNG, US_CENTER_LAT);
  }

  function getPopupBounds(): HoverPopupBounds {
    const [mx, my] = getMarkerScreenPos();
    return { x: mx - BUBBLE_W / 2, y: my - TIP_H - BUBBLE_H, width: BUBBLE_W, height: BUBBLE_H };
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

    const [mx, my] = getMarkerScreenPos();

    // Marker: the hover target.
    ctx.beginPath();
    ctx.arc(mx, my, 6, 0, Math.PI * 2);
    ctx.fillStyle = '#1e6fd9';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    if (hovering) {
      const b = getPopupBounds();
      const tipX = mx;
      const tipY = my;

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      const r = 6;
      ctx.beginPath();
      ctx.moveTo(b.x + r, b.y);
      ctx.lineTo(b.x + b.width - r, b.y);
      ctx.arcTo(b.x + b.width, b.y, b.x + b.width, b.y + r, r);
      ctx.lineTo(b.x + b.width, b.y + b.height - r);
      ctx.arcTo(b.x + b.width, b.y + b.height, b.x + b.width - r, b.y + b.height, r);
      ctx.lineTo(tipX + 7, b.y + b.height);
      ctx.lineTo(tipX, tipY - 2);
      ctx.lineTo(tipX - 7, b.y + b.height);
      ctx.lineTo(b.x + r, b.y + b.height);
      ctx.arcTo(b.x, b.y + b.height, b.x, b.y + b.height - r, r);
      ctx.lineTo(b.x, b.y + r);
      ctx.arcTo(b.x, b.y, b.x + r, b.y, r);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#222222';
      ctx.font = 'bold 13px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText('You hovered here!', b.x + b.width / 2, b.y + b.height / 2);
    }

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function localPoint(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  function updateHover(x: number, y: number): void {
    const [mx, my] = getMarkerScreenPos();
    const next = Math.hypot(x - mx, y - my) <= HOVER_RADIUS;
    if (next !== hovering) {
      hovering = next;
      draw();
    }
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    const [x, y] = localPoint(e);
    updateHover(x, y);
    if (!dragging) return;
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
    const [x, y] = localPoint(e);
    updateHover(x, y);
  }

  function onPointerLeave(): void {
    if (hovering && !dragging) {
      hovering = false;
      draw();
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
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
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
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    get popupVisible() { return hovering; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    getMarkerScreenPos,
    getPopupBounds,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
