export interface ScatterMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  pointCount: number;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  getScreenPos(lng: number, lat: number): [number, number];
  radiusAt(weight: number): number;
  destroy(): void;
}

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const BACKGROUND = '#0b1020';
const LOW = [43, 111, 214];
const HIGH = [255, 179, 64];

export async function mount(canvas: HTMLCanvasElement, pointsUrl: string): Promise<ScatterMap> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  if (!ctx) throw new Error('2D context not available');

  const res = await fetch(pointsUrl);
  if (!res.ok) throw new Error(`failed to fetch points: ${res.status}`);
  const points = new Float32Array(await res.arrayBuffer());
  const pointCount = points.length / 4;

  let centerMx = mercX(-73.98);
  let centerMy = mercY(40.75);
  let zoom = 12;
  let dpr = window.devicePixelRatio || 1;
  let width = canvas.clientWidth || 800;
  let height = canvas.clientHeight || 600;

  // Weight is 1 or 2 in this data set: one colour per weight.
  const colors = [LOW, HIGH].map((c) => `rgb(${c[0]},${c[1]},${c[2]})`);
  const CHUNK = 256;

  function resize(): void {
    dpr = window.devicePixelRatio || 1;
    width = canvas.clientWidth || 800;
    height = canvas.clientHeight || 600;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    draw();
  }

  // Every point has a radius of 30 m in deck.gl's example (getRadius 1,
  // radiusScale 30): the weight is a class (1 and 2 in two colours), not a size. Sized by
  // weight, the larger orange squares won every overlap.
  function radiusAt(_weight: number): number {
    const metresPerPx = 40075016.686 * Math.cos(Math.atan(Math.sinh(Math.PI * (1 - 2 * centerMy)))) / (256 * Math.pow(2, zoom));
    return Math.max(0.5, 30 / metresPerPx);
  }

  function getScreenPos(lng: number, lat: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [width / 2 + (mercX(lng) - centerMx) * scale, height / 2 + (mercY(lat) - centerMy) * scale];
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    // One path per colour, but per chunk of CHUNK points in data order: with
    // all of weight 1 first and all of weight 2 after, the overlapping orange
    // squares hid nearly every blue one (46% of the points). deck.gl draws in
    // data order, so the colours mix. Squares instead of arcs: the circle
    // tessellation is what kept the software rasterizer from hitting 60 Hz.
    // Snapping to whole pixels also skips antialiasing.
    const radius = radiusAt(1);
    for (let start = 0; start < pointCount; start += CHUNK) {
      const end = Math.min(pointCount, start + CHUNK);
      for (let bucket = 0; bucket < 2; bucket++) {
        ctx.fillStyle = colors[bucket];
        ctx.beginPath();
        let any = false;
        for (let i = start; i < end; i++) {
          const w = points[i * 4 + 2];
          if (Math.min(w, 2) - 1 !== bucket) continue;
          const x = originX + points[i * 4] * scale;
          const y = originY + points[i * 4 + 1] * scale;
          if (x < -8 || x > width + 8 || y < -8 || y > height + 8) continue;
          const size = Math.max(1, Math.round(radius * 2));
          ctx.rect(Math.round(x - size / 2), Math.round(y - size / 2), size, size);
          any = true;
        }
        if (any) ctx.fill();
      }
    }

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
    panBy(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
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
    zoomAt(e, zoom + (e.deltaY < 0 ? 0.25 : -0.25));
  }, { passive: false });
  window.addEventListener('resize', resize);

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
    zoom = Math.max(2, Math.min(18, z));
    draw();
  }

  resize();

  return {
    canvas,
    ctx,
    pointCount,
    draw,
    panBy,
    setZoom,
    getScreenPos,
    radiusAt,
    destroy(): void {
      window.removeEventListener('resize', resize);
    },
  };
}
