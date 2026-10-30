export interface HoverFillMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  hovering: boolean;
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

// A box over Ethiopia, matching the example's idea of a layer that changes
// its paint property while the pointer is over it.
const WEST = 30;
const EAST = 45;
const SOUTH = 0;
const NORTH = 15;
const BOX_CENTER_LNG = (WEST + EAST) / 2;
const BOX_CENTER_LAT = (SOUTH + NORTH) / 2;
const FILL = '#008888';
const HOVER_FILL = '#ff8800';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(BOX_CENTER_LNG);
const defaultCenterMy = mercY(BOX_CENTER_LAT);

export async function mount(
  canvas: HTMLCanvasElement,
  boxUrl: string,
  landUrl: string,
): Promise<HoverFillMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const [boxRes, landRes] = await Promise.all([fetch(boxUrl), fetch(landUrl)]);
  if (!boxRes.ok) throw new Error(`failed to fetch box: ${boxRes.status}`);
  if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);

  const boxRing = (await boxRes.json()) as [number, number][];
  const polygons = (await landRes.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 4;
  let hovering = false;
  let dpr = window.devicePixelRatio || 1;

  const boxMinX = mercX(WEST);
  const boxMaxX = mercX(EAST);
  const boxMinY = mercY(NORTH);
  const boxMaxY = mercY(SOUTH);

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

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#b8d6e8';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#dad7d0';
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

    // The layer whose paint property the buttons change.
    ctx.beginPath();
    for (let i = 0; i < boxRing.length; i++) {
      const sx = originX + boxRing[i][0] * scale;
      const sy = originY + boxRing[i][1] * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
    ctx.fillStyle = hovering ? HOVER_FILL : FILL;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

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

  function updateHover(x: number, y: number): void {
    const scale = 256 * Math.pow(2, zoom);
    const mx = centerMx + (x - width / 2) / scale;
    const my = centerMy + (y - height / 2) / scale;
    const inside = mx >= boxMinX && mx <= boxMaxX && my >= boxMinY && my <= boxMaxY;
    if (inside === hovering) return;
    hovering = inside;
    canvas.style.cursor = inside ? 'pointer' : 'grab';
    draw();
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      panBy(dx, dy);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    updateHover(e.clientX - rect.left, e.clientY - rect.top);
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  }

  function onPointerLeave(): void {
    if (!hovering) return;
    hovering = false;
    canvas.style.cursor = 'grab';
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
    zoom = Math.max(1, Math.min(18, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = 4;
    hovering = false;
    canvas.style.cursor = 'grab';
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
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
    get hovering() { return hovering; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    resetView,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
