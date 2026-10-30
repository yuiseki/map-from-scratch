export interface PopupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  closeBtn: { x: number; y: number; size: number };
}

export interface ClickPopupMap {
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
  getPopupBounds(): PopupBounds;
  getPopupAnchor(): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const US_CENTER_LNG = -96.0;
const US_CENTER_LAT = 37.8;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;
const invMercY = (my: number): number =>
  (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360) / Math.PI - 90;

const defaultCenterMx = mercX(US_CENTER_LNG);
const defaultCenterMy = mercY(US_CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<ClickPopupMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 3;
  let popupVisible = false;
  let anchorLng = US_CENTER_LNG;
  let anchorLat = US_CENTER_LAT;
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

  function getPopupBounds(): PopupBounds {
    const [tipX, tipY] = getScreenPos(anchorLng, anchorLat);
    const bubbleW = 160;
    const bubbleH = 44;
    const tipH = 10;
    const bx = tipX - bubbleW / 2;
    const by = tipY - tipH - bubbleH;
    return {
      x: bx,
      y: by,
      width: bubbleW,
      height: bubbleH,
      closeBtn: { x: bx + bubbleW - 20, y: by + 6, size: 16 },
    };
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

    // Clicked marker: a small dot at the popup anchor.
    if (popupVisible) {
      const [tipX, tipY] = getScreenPos(anchorLng, anchorLat);
      const bounds = getPopupBounds();

      ctx.beginPath();
      ctx.arc(tipX, tipY, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#1e6fd9';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;

      const r = 6;
      ctx.beginPath();
      ctx.moveTo(bounds.x + r, bounds.y);
      ctx.lineTo(bounds.x + bounds.width - r, bounds.y);
      ctx.arcTo(bounds.x + bounds.width, bounds.y, bounds.x + bounds.width, bounds.y + r, r);
      ctx.lineTo(bounds.x + bounds.width, bounds.y + bounds.height - r);
      ctx.arcTo(bounds.x + bounds.width, bounds.y + bounds.height, bounds.x + bounds.width - r, bounds.y + bounds.height, r);
      ctx.lineTo(tipX + 8, bounds.y + bounds.height);
      ctx.lineTo(tipX, tipY);
      ctx.lineTo(tipX - 8, bounds.y + bounds.height);
      ctx.lineTo(bounds.x + r, bounds.y + bounds.height);
      ctx.arcTo(bounds.x, bounds.y + bounds.height, bounds.x, bounds.y + bounds.height - r, r);
      ctx.lineTo(bounds.x, bounds.y + r);
      ctx.arcTo(bounds.x, bounds.y, bounds.x + r, bounds.y, r);
      ctx.closePath();
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#222222';
      ctx.font = 'bold 14px system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.fillText('You clicked here!', bounds.x + 14, bounds.y + bounds.height / 2);

      ctx.fillStyle = '#888888';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('×', bounds.closeBtn.x + bounds.closeBtn.size / 2, bounds.closeBtn.y + bounds.closeBtn.size / 2);
    }

    ctx.restore();
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

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    didDrag = false;
    downX = lastX = e.clientX;
    downY = lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) didDrag = true;
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

    // Clicking the × closes; clicking anywhere else opens the popup there.
    if (popupVisible) {
      const btn = getPopupBounds().closeBtn;
      if (x >= btn.x && x <= btn.x + btn.size && y >= btn.y && y <= btn.y + btn.size) {
        popupVisible = false;
        draw();
        return;
      }
    }

    const scale = 256 * Math.pow(2, zoom);
    const mx = centerMx + (x - width / 2) / scale;
    const my = Math.max(0, Math.min(1, centerMy + (y - height / 2) / scale));
    anchorLng = mx * 360 - 180;
    anchorLat = invMercY(my);
    popupVisible = true;
    draw();
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
  canvas.addEventListener('wheel', onWheel, { passive: false });

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    get popupVisible() { return popupVisible; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    getPopupBounds,
    getPopupAnchor: (): [number, number] => [anchorLng, anchorLat],
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
