export interface IconMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getIconScreenPos(): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

// The MapLibre example puts its icon at [0, 0] (the Gulf of Guinea).
const ICON_LNG = 0;
const ICON_LAT = 0;

const SPRITE_SIZE = 48;

const mercY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2;
const targetMx = (ICON_LNG + 180) / 360;
const targetMy = mercY(ICON_LAT);

// A tiny "cat" sprite drawn once into an offscreen canvas, standing in for the
// cat.png that the MapLibre example loads. No image request at run time.
function makeIconSprite(scale: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = SPRITE_SIZE * scale;
  const g = c.getContext('2d')!;
  g.scale(scale, scale);

  // ears
  g.fillStyle = '#F5A623';
  g.strokeStyle = '#C77C14';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(8, 16);
  g.lineTo(12, 3);
  g.lineTo(22, 10);
  g.closePath();
  g.fill();
  g.stroke();
  g.beginPath();
  g.moveTo(40, 16);
  g.lineTo(36, 3);
  g.lineTo(26, 10);
  g.closePath();
  g.fill();
  g.stroke();

  // head
  g.beginPath();
  g.arc(24, 24, 20, 0, Math.PI * 2);
  g.fillStyle = '#F5A623';
  g.fill();
  g.stroke();

  // eyes
  g.fillStyle = '#222222';
  g.beginPath();
  g.ellipse(17, 20, 2.6, 3.6, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.ellipse(31, 20, 2.6, 3.6, 0, 0, Math.PI * 2);
  g.fill();

  // muzzle and nose
  g.beginPath();
  g.ellipse(24, 31, 8, 5, 0, 0, Math.PI * 2);
  g.fillStyle = '#FFF4E0';
  g.fill();
  g.beginPath();
  g.moveTo(21, 27);
  g.lineTo(27, 27);
  g.lineTo(24, 31);
  g.closePath();
  g.fillStyle = '#E8607A';
  g.fill();

  // whiskers
  g.strokeStyle = '#8a5a12';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(12, 28);
  g.lineTo(3, 26);
  g.moveTo(12, 32);
  g.lineTo(3, 34);
  g.moveTo(36, 28);
  g.lineTo(45, 26);
  g.moveTo(36, 32);
  g.lineTo(45, 34);
  g.stroke();

  return c;
}

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<IconMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('2D context not available');

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = targetMx;
  let centerMy = targetMy;
  let zoom = 3;
  let dpr = window.devicePixelRatio || 1;

  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  let sprite = makeIconSprite(dpr);

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    sprite = makeIconSprite(dpr);
    draw();
  }

  function getIconScreenPos(): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [width / 2 + (targetMx - centerMx) * scale, height / 2 + (targetMy - centerMy) * scale];
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

    // World copies, as MapLibre does.
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

    // The sprite is uploaded once and blitted every frame.
    const [ix, iy] = getIconScreenPos();
    ctx.drawImage(sprite, ix - SPRITE_SIZE / 2, iy - SPRITE_SIZE / 2, SPRITE_SIZE, SPRITE_SIZE);

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

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getIconScreenPos,
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
