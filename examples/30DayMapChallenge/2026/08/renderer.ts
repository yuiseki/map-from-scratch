import type { MeshCell } from './utopia.ts';

interface Geometry {
  type: 'Point' | 'Polygon' | 'MultiPolygon';
  coordinates: [number, number] | [number, number][][] | [number, number][][][];
}
interface Cell extends MeshCell {
  code: string; population: number; parkMeters: number; schoolMeters: number;
  walkableToPark: boolean; walkableToSchool: boolean;
}
interface NamedGeometry { name: string; geometry: Geometry }
interface UtopiaData {
  center: [number, number]; bounds: { minLon: number; maxLon: number; minLat: number; maxLat: number };
  walkMeters: number; cells: Cell[]; parks: NamedGeometry[]; schools: NamedGeometry[];
  attribution: { census: string; parks: string; schools: string };
}
export interface UtopiaMap {
  canvas: HTMLCanvasElement; data: UtopiaData; firstFrameMs: number;
  state: { zoom: number; panX: number; panY: number };
  draw(): void;
}

function drawRing(context: CanvasRenderingContext2D, ring: [number, number][], project: (point: [number, number]) => [number, number]) {
  if (ring.length < 3) return;
  context.moveTo(...project(ring[0]!));
  for (let i = 1; i < ring.length; i++) context.lineTo(...project(ring[i]!));
  context.closePath();
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<UtopiaMap> {
  const started = performance.now();
  const response = await fetch(`${dataUrl}/utopia.json`);
  if (!response.ok) throw new Error(`Utopia data request failed: ${response.status}`);
  const data = await response.json() as UtopiaData;
  if (data.cells.length < 200 || data.parks.length < 1 || data.schools.length < 1) throw new Error('Utopia data is incomplete');
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const state = { zoom: 1, panX: 0, panY: 0 };
  let firstFrameMs = 0;
  const map: UtopiaMap = { canvas, data, firstFrameMs, state, draw };

  function resize() {
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }
  function project(point: [number, number]): [number, number] {
    const bounds = data.bounds;
    const cosLat = Math.cos(data.center[1] * Math.PI / 180);
    const worldWidth = (bounds.maxLon - bounds.minLon) * cosLat;
    const worldHeight = bounds.maxLat - bounds.minLat;
    const fit = Math.min(canvas.width / worldWidth, canvas.height / worldHeight) * 0.91 * state.zoom;
    return [canvas.width / 2 + (point[0] - data.center[0]) * cosLat * fit + state.panX,
      canvas.height / 2 - (point[1] - data.center[1]) * fit + state.panY];
  }
  function drawGeometry(geometry: Geometry, fill: string) {
    context!.beginPath();
    if (geometry.type === 'Polygon') for (const ring of geometry.coordinates as [number, number][][]) drawRing(context!, ring, project);
    else if (geometry.type === 'MultiPolygon') for (const polygon of geometry.coordinates as [number, number][][][]) {
      for (const ring of polygon) drawRing(context!, ring, project);
    }
    context!.fillStyle = fill; context!.fill('evenodd');
  }
  function draw() {
    resize();
    context!.fillStyle = '#101c23'; context!.fillRect(0, 0, canvas.width, canvas.height);
    const bounds = data.bounds;
    const clipTopLeft = project([bounds.minLon, bounds.maxLat]);
    const clipBottomRight = project([bounds.maxLon, bounds.minLat]);
    context!.save();
    context!.beginPath();
    context!.rect(clipTopLeft[0], clipTopLeft[1], clipBottomRight[0] - clipTopLeft[0], clipBottomRight[1] - clipTopLeft[1]);
    context!.clip();
    context!.strokeStyle = 'rgba(169,197,192,.10)'; context!.lineWidth = Math.max(1, dpr);
    context!.beginPath();
    for (let lon = Math.ceil(bounds.minLon * 100) / 100; lon < bounds.maxLon; lon += 0.01) {
      context!.moveTo(...project([lon, bounds.minLat])); context!.lineTo(...project([lon, bounds.maxLat]));
    }
    for (let lat = Math.ceil(bounds.minLat * 100) / 100; lat < bounds.maxLat; lat += 0.01) {
      context!.moveTo(...project([bounds.minLon, lat])); context!.lineTo(...project([bounds.maxLon, lat]));
    }
    context!.stroke();

    const maxPopulation = Math.max(1, ...data.cells.map((cell) => cell.population));
    for (const cell of data.cells) {
      const [x, y] = project([cell.west, cell.north]), [x2, y2] = project([cell.east, cell.south]);
      const people = Math.log1p(cell.population) / Math.log1p(maxPopulation);
      context!.fillStyle = cell.walkableToPark && cell.walkableToSchool
        ? `rgb(${Math.round(37 + people * 35)},${Math.round(110 + people * 100)},${Math.round(100 + people * 55)})`
        : `rgb(${Math.round(46 + people * 55)},${Math.round(58 + people * 49)},${Math.round(70 + people * 48)})`;
      context!.fillRect(x, y, Math.max(0.7 * dpr, x2 - x - 0.55 * dpr), Math.max(0.7 * dpr, y2 - y - 0.55 * dpr));
    }
    for (const park of data.parks) drawGeometry(park.geometry, 'rgba(127,220,156,.42)');
    for (const school of data.schools) {
      if (school.geometry.type !== 'Point') continue;
      const [x, y] = project(school.geometry.coordinates as [number, number]);
      context!.beginPath(); context!.arc(x, y, 2.1 * dpr, 0, Math.PI * 2);
      context!.fillStyle = '#f4d28b'; context!.fill();
    }
    const origin = project(data.center);
    context!.beginPath(); context!.arc(origin[0], origin[1], 4 * dpr, 0, Math.PI * 2);
    context!.fillStyle = '#fff4d5'; context!.fill();
    context!.restore();
    if (!map.firstFrameMs) { map.firstFrameMs = performance.now() - started; }
  }

  let dragging = false, previousX = 0, previousY = 0;
  canvas.addEventListener('pointerdown', (event) => { dragging = true; previousX = event.clientX; previousY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    state.panX += (event.clientX - previousX) * dpr; state.panY += (event.clientY - previousY) * dpr;
    previousX = event.clientX; previousY = event.clientY; draw();
  });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointercancel', () => { dragging = false; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = Math.max(0.7, Math.min(8, state.zoom * Math.exp(-event.deltaY * 0.001))); draw(); }, { passive: false });
  new ResizeObserver(draw).observe(canvas);
  draw();
  return map;
}
