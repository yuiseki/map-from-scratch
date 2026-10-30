export interface WorldMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

export async function mount(
  canvas: HTMLCanvasElement,
  landUrl: string,
): Promise<WorldMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  let centerMx = 0.5;
  let centerMy = 0.5;
  let zoom = 1;
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
    ctx.fillStyle = '#aad3df';
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    // Land polygons
    ctx.fillStyle = '#f0eee8';
    ctx.strokeStyle = '#d0cdc4';
    ctx.lineWidth = 1;

    // Wrap-around tiles horizontally (-1, 0, 1) so the world repeats smoothly if zoomed out
    const minWrap = Math.floor((centerMx - width / (2 * scale)));
    const maxWrap = Math.floor((centerMx + width / (2 * scale)));

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

    // MapLibre badge in bottom-left
    const badgeW = 92;
    const badgeH = 24;
    const badgeX = 12;
    const badgeY = height - badgeH - 12;

    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
    ctx.fill();

    ctx.fillStyle = '#1f3a52';
    ctx.font = 'bold 12px sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText('MapLibre', badgeX + 8, badgeY + badgeH / 2);

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
    setZoom(zoom + dz);
  }

  function panBy(dx: number, dy: number): void {
    const scale = 256 * Math.pow(2, zoom);
    centerMx -= dx / scale;
    centerMy -= dy / scale;
    draw();
  }

  function setZoom(z: number): void {
    zoom = Math.max(0.5, Math.min(10, z));
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
    draw,
    panBy,
    setZoom,
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
