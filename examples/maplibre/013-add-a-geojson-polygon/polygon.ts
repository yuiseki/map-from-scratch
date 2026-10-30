export interface GeoJsonPolygonMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  setPolygonStyle(color: string, opacity: number, strokeColor?: string, strokeWidth?: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const MAINE_CENTER_LNG = -68.13734351262877;
const MAINE_CENTER_LAT = 45.137451890638886;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(MAINE_CENTER_LNG);
const defaultCenterMy = mercY(MAINE_CENTER_LAT);

export async function mount(
  canvas: HTMLCanvasElement,
  maineUrl: string,
  landUrl: string,
): Promise<GeoJsonPolygonMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const [maineRes, landRes] = await Promise.all([
    fetch(maineUrl),
    fetch(landUrl),
  ]);

  if (!maineRes.ok) throw new Error(`failed to fetch maine: ${maineRes.status}`);
  if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);

  const maineRing = (await maineRes.json()) as [number, number][];
  const polygons = (await landRes.json()) as Polygon[];

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = 5;
  let fillColor = '#008888';
  let fillOpacity = 0.8;
  let strokeColor = '#004444';
  let strokeWidth = 1.5;
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
    const mx = mercX(lon);
    const my = mercY(lat);
    const scale = 256 * Math.pow(2, zoom);
    const sx = width / 2 + (mx - centerMx) * scale;
    const sy = height / 2 + (my - centerMy) * scale;
    return [sx, sy];
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    // Ocean background
    ctx.fillStyle = '#b8d6e8';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    // Land polygons
    ctx.fillStyle = '#f2efe9';
    ctx.strokeStyle = '#dad7d0';
    ctx.lineWidth = 1;

    // Repeat the world horizontally so land continues past the antimeridian,
    // as MapLibre's world copies do.
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

    // GeoJSON Polygon (Maine)
    if (maineRing.length > 2) {
      ctx.save();
      ctx.beginPath();
      for (let i = 0; i < maineRing.length; i++) {
        const sx = originX + maineRing[i][0] * scale;
        const sy = originY + maineRing[i][1] * scale;
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();

      ctx.globalAlpha = fillOpacity;
      ctx.fillStyle = fillColor;
      ctx.fill();

      if (strokeWidth > 0) {
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
      ctx.restore();
    }

    ctx.restore();
  }

  // Pointer drag panning
  let dragging = false;
  let startX = 0;
  let startY = 0;

  function onPointerDown(e: PointerEvent): void {
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    startX = e.clientX;
    startY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (!dragging) return;
    dragging = false;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    const dz = e.deltaY < 0 ? 0.25 : -0.25;
    zoomAt(e, zoom + dz);
  }

  // Zoom keeping the point under the pointer still (MapLibre, Leaflet do).
  function zoomAt(e: WheelEvent, z: number): void {
    const r = canvas.getBoundingClientRect();
    const ox = e.clientX - r.left - r.width / 2, oy = e.clientY - r.top - r.height / 2;
    const before = 256 * Math.pow(2, zoom);
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
    zoom = Math.max(1, Math.min(20, z));
    draw();
  }

  function setPolygonStyle(
    color: string,
    opacity: number,
    stroke?: string,
    width?: number,
  ): void {
    fillColor = color;
    fillOpacity = opacity;
    if (stroke !== undefined) strokeColor = stroke;
    if (width !== undefined) strokeWidth = width;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('resize', resize);

  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] {
      return [centerMx, centerMy];
    },
    get zoom(): number {
      return zoom;
    },
    get fillColor(): string {
      return fillColor;
    },
    get fillOpacity(): number {
      return fillOpacity;
    },
    get strokeColor(): string {
      return strokeColor;
    },
    get strokeWidth(): number {
      return strokeWidth;
    },
    draw,
    panBy,
    setZoom,
    setPolygonStyle,
    getScreenPos,
    destroy(): void {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', resize);
    },
  };
}
