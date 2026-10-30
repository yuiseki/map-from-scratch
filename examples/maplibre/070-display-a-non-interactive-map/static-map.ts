export interface StaticMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  interactive: boolean;
  draw(): void;
  getScreenPos(lon: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const TARGET_LNG = 74.5;
const TARGET_LAT = 40.0;

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const centerMx = mercX(TARGET_LNG);
const centerMy = mercY(TARGET_LAT);

export async function mount(
  canvas: HTMLCanvasElement,
  landUrl: string,
): Promise<StaticMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  const zoom = 3;
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

    // Repeat the world horizontally: the view reaches past the antimeridian
    // (Chukotka), as MapLibre's world copies do.
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

    ctx.restore();
  }

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
    interactive: false,
    draw,
    getScreenPos,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
