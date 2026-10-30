export interface GradientIconMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  iconReady(): boolean;
  iconRect(): { x: number; y: number; width: number; height: number };
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

// Mapbox "Add an image (generated)": a 64×64 gradient is generated pixel by
// pixel at runtime and drawn as a symbol icon at [0, 0].
const ICON_SIZE = 64;
const ANCHOR_LNG = 0;
const ANCHOR_LAT = 0;
const DEFAULT_ZOOM = 2;

const OCEAN = '#aad3df';
const LAND = '#f0eee8';
const LAND_EDGE = '#d0cdc4';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(ANCHOR_LNG);
const defaultCenterMy = mercY(ANCHOR_LAT);

function generateGradient(size: number): HTMLCanvasElement {
  const off = document.createElement('canvas');
  off.width = size;
  off.height = size;
  const g = off.getContext('2d');
  if (!g) throw new Error('2D context not available');
  const image = g.createImageData(size, size);
  const data = image.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4;
      data[offset] = (x / size) * 255;
      data[offset + 1] = (y / size) * 255;
      data[offset + 2] = (y / size) * 255;
      data[offset + 3] = 255;
    }
  }
  g.putImageData(image, 0, 0);
  return off;
}

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<GradientIconMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  const icon = generateGradient(ICON_SIZE);

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = DEFAULT_ZOOM;
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

  // Symbol icon-size is a screen-space size: the icon does not grow with zoom.
  function iconRect(): { x: number; y: number; width: number; height: number } {
    const [x, y] = getScreenPos(ANCHOR_LNG, ANCHOR_LAT);
    return { x: x - ICON_SIZE / 2, y: y - ICON_SIZE / 2, width: ICON_SIZE, height: ICON_SIZE };
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
            const x = shiftX + ring[i][0] * scale;
            const y = originY + ring[i][1] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    const r = iconRect();
    ctx.drawImage(icon, r.x, r.y);
    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    try { canvas.releasePointerCapture(e.pointerId); } catch {}
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
      zoom + (e.deltaY < 0 ? 0.5 : -0.5),
    );
  }, { passive: false });
  window.addEventListener('resize', resize);

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
    zoom = Math.max(1, Math.min(12, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = DEFAULT_ZOOM;
    draw();
  }

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
    iconReady: () => icon.width === ICON_SIZE && icon.height === ICON_SIZE,
    iconRect,
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    resetView,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
