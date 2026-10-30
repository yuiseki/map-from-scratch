export interface PointerReadout {
  x: number;
  y: number;
  lng: number;
  lat: number;
}

export interface PointerMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  pointer: PointerReadout | null;
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

const CENTER_LNG = -74.5;
const CENTER_LAT = 40;
const DEFAULT_ZOOM = 3;

const OCEAN = '#aad3df';
const LAND = '#f0eee8';
const LAND_EDGE = '#d0cdc4';
const CROSS = '#e63946';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;
const invMercY = (my: number): number =>
  (Math.atan(Math.exp((1 - 2 * my) * Math.PI)) * 360) / Math.PI - 90;
const wrapLng = (lng: number): number => ((((lng + 180) % 360) + 360) % 360) - 180;

const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<PointerMap> {
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

  // Screen-space pointer; the geographic readout is recomputed on every draw
  // from the current camera, so a pan or zoom under a still cursor updates it.
  let pointerX = 0;
  let pointerY = 0;
  let hasPointer = false;

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

  function readout(): PointerReadout | null {
    if (!hasPointer) return null;
    const scale = 256 * Math.pow(2, zoom);
    const mx = centerMx + (pointerX - width / 2) / scale;
    const my = Math.max(0, Math.min(1, centerMy + (pointerY - height / 2) / scale));
    return {
      x: pointerX,
      y: pointerY,
      lng: wrapLng(mx * 360 - 180),
      lat: invMercY(my),
    };
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

    if (hasPointer) {
      // 1 px crosshair with fillRect on rounded coordinates: a stroked line at
      // an integer coordinate would land on half-pixels and antialias into two
      // rows. The dot keeps the exact pointer pixel.
      const x = Math.round(pointerX);
      const y = Math.round(pointerY);
      ctx.fillStyle = CROSS;
      ctx.fillRect(0, y, width, 1);
      ctx.fillRect(x, 0, 1, height);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  function localPoint(e: PointerEvent): [number, number] {
    const rect = canvas.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerMove(e: PointerEvent): void {
    if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      panBy(dx, dy);
      return;
    }
    const [x, y] = localPoint(e);
    pointerX = x;
    pointerY = y;
    hasPointer = true;
    draw();
  }

  function onPointerLeave(): void {
    hasPointer = false;
    draw();
  }

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerUp(e: PointerEvent): void {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
      zoom + (e.deltaY < 0 ? 0.25 : -0.25),
    );
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
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);

  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom() {
      return zoom;
    },
    get pointer() {
      return readout();
    },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    resetView(): void {
      centerMx = defaultCenterMx;
      centerMy = defaultCenterMy;
      zoom = DEFAULT_ZOOM;
      hasPointer = false;
      draw();
    },
    destroy(): void {
      window.removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('wheel', onWheel);
    },
  };
}
