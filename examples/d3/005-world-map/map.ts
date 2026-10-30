export interface WorldMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  draw(): void;
  getScreenPos(lon: number, lat: number): [number, number];
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const OCEAN = '#e6f0f5';
const LAND = '#cccccc';
const COAST = '#ffffff';
const GRATICULE = '#a9bfca';

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<WorldMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

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

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, width, height);

    // Graticule every 10 degrees, under the land like the original map.
    ctx.strokeStyle = GRATICULE;
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    for (let lon = -180; lon <= 180; lon += 10) {
      const x = ((lon + 180) / 360) * width;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let lat = -80; lat <= 80; lat += 10) {
      const y = ((90 - lat) / 180) * height;
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    ctx.fillStyle = LAND;
    ctx.strokeStyle = COAST;
    ctx.lineWidth = 0.8;
    for (const poly of polygons) {
      ctx.beginPath();
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const x = ring[i][0] * width;
          const y = ring[i][1] * height;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }
      ctx.fill();
      ctx.stroke();
    }

    ctx.strokeStyle = '#8fa6b3';
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    ctx.restore();
  }

  function getScreenPos(lon: number, lat: number): [number, number] {
    return [((lon + 180) / 360) * width, ((90 - lat) / 180) * height];
  }

  window.addEventListener('resize', resize);
  resize();

  return {
    canvas,
    ctx,
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    draw,
    getScreenPos,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
