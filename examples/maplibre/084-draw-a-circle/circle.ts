export interface CircleMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  radiusM: number;
  center: [number, number];
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  getScreenPos(lng: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const OCEAN = '#b8d6e8';
const LAND = '#f2efe9';
const LAND_EDGE = '#dad7d0';
const CIRCLE_FILL = 'rgba(0,128,255,0.5)';
const CIRCLE_STROKE = '#0080ff';

export async function mount(
  canvas: HTMLCanvasElement,
  circleUrl: string,
  landUrl: string,
): Promise<CircleMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const [circleRes, landRes] = await Promise.all([fetch(circleUrl), fetch(landUrl)]);
  if (!circleRes.ok) throw new Error(`failed to fetch circle: ${circleRes.status}`);
  if (!landRes.ok) throw new Error(`failed to fetch land: ${landRes.status}`);

  const circle = (await circleRes.json()) as { center: [number, number]; radiusM: number; ring: Ring };
  const polygons = (await landRes.json()) as Polygon[];

  let centerMx = mercX(circle.center[0]);
  let centerMy = mercY(circle.center[1]);
  let zoom = 9;
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

  function getScreenPos(lng: number, lat: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (mercX(lng) - centerMx) * scale,
      height / 2 + (mercY(lat) - centerMy) * scale,
    ];
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

    // The 50 km circle is baked as a mercator ring, so it scales with zoom
    // exactly like MapLibre's turf.circle polygon.
    ctx.beginPath();
    for (let i = 0; i < circle.ring.length; i++) {
      const x = originX + circle.ring[i][0] * scale;
      const y = originY + circle.ring[i][1] * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = CIRCLE_FILL;
    ctx.fill();
    ctx.strokeStyle = CIRCLE_STROKE;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.restore();
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
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
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom + (e.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });
  window.addEventListener('resize', resize);

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

  resize();

  return {
    canvas,
    ctx,
    radiusM: circle.radiusM,
    get center(): [number, number] {
      return circle.center;
    },
    draw,
    panBy,
    setZoom,
    getScreenPos,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
