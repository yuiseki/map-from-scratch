import { initialView, panBy, screenPoint, zoomAt, type View, type Viewport } from './camera.ts';
import { airportTypeColors, airportTypeRadii, decodeAirports, type EncodedAirport } from './airports.ts';

const WORLD_WIDTH = 5.4132;
const WORLD_HEIGHT = 2.6348;
type Ring = [number, number][];
interface Stats { source: string; sourceAirportRows: number; renderedAirports: number; scheduledServiceAirports: number; excludedClosedOrUnlocated: number; byType: Record<string, number>; landRings: number; landVertices: number; airportRecordBytes: number }

export type AirportMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const started = performance.now();
  const [landResponse, airportResponse, statsResponse] = await Promise.all(['land.json', 'airports.bin', 'stats.json'].map((name) => fetch(`${base}/${name}`)));
  for (const [name, response] of [['land.json', landResponse], ['airports.bin', airportResponse], ['stats.json', statsResponse]] as const) {
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  }
  const [land, airportBuffer, stats] = await Promise.all([
    landResponse.json() as Promise<Ring[]>, airportResponse.arrayBuffer(), statsResponse.json() as Promise<Stats>,
  ]);
  const records = decodeAirports(airportBuffer);
  if (records.length !== stats.renderedAirports) throw new Error(`Airport count mismatch: ${records.length} / ${stats.renderedAirports}`);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const staticCanvas = document.createElement('canvas');
  const staticContext = staticCanvas.getContext('2d', { alpha: false });
  if (!staticContext) throw new Error('Offscreen Canvas 2D is unavailable');
  const viewport: Viewport = { width: 0, height: 0, imageWidth: WORLD_WIDTH, imageHeight: WORLD_HEIGHT };
  const view = initialView();
  let dpr = 1;
  let drag: [number, number] | null = null;
  const grouped: EncodedAirport[][] = Array.from({ length: 6 }, () => []);
  for (const point of records) grouped[point.kind]!.push(point);

  function projectNormalized(x: number, y: number, activeView: View = view): [number, number] {
    return screenPoint(x * WORLD_WIDTH, y * WORLD_HEIGHT, viewport, activeView);
  }
  function projectedLonLat(lon: number, lat: number, activeView: View = view): [number, number] {
    const theta = Math.asin(Math.sqrt(3) / 2 * Math.sin(lat * Math.PI / 180));
    const theta2 = theta * theta, theta6 = theta2 * theta2 * theta2;
    const p = 1.340264 - 0.081106 * theta2 + 0.000893 * theta6 + 0.003796 * theta6 * theta2;
    const x = 2 * Math.sqrt(3) * lon * Math.PI / 180 * Math.cos(theta) / (3 * p);
    const y = theta * p;
    return projectNormalized(x / WORLD_WIDTH + 0.5, 0.5 - y / WORLD_HEIGHT, activeView);
  }

  function paintStatic() {
    if (!viewport.width || !viewport.height) return;
    const ctx = staticContext!;
    const baseView = initialView();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101d28';
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.lineWidth = 0.65;
    ctx.strokeStyle = 'rgba(153,184,181,.18)';
    ctx.beginPath();
    for (let lon = -150; lon <= 180; lon += 30) {
      for (let lat = -88; lat <= 88; lat += 2) {
        const [x, y] = projectedLonLat(lon, lat, baseView);
        if (lat === -88) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    for (let lat = -60; lat <= 75; lat += 15) {
      for (let lon = -180; lon <= 180; lon += 2) {
        const [x, y] = projectedLonLat(lon, lat, baseView);
        if (lon === -180) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.beginPath();
    for (const ring of land) {
      if (ring.length < 3) continue;
      const [firstX, firstY] = projectNormalized(ring[0]![0], ring[0]![1], baseView);
      ctx.moveTo(firstX, firstY);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = projectNormalized(ring[i]![0], ring[i]![1], baseView);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fillStyle = '#d9c8a5';
    ctx.fill();
    ctx.lineWidth = 0.55;
    ctx.strokeStyle = 'rgba(72,79,72,.42)';
    ctx.stroke();

    const zoomSize = 1;
    ctx.globalAlpha = 0.84;
    for (let kind = 5; kind >= 0; kind--) {
      const points = grouped[kind]!;
      const radius = Math.max(0.7, airportTypeRadii[kind]! * zoomSize);
      ctx.beginPath();
      for (const point of points) {
        const [x, y] = projectNormalized(point.x, point.y, baseView);
        ctx.moveTo(x + radius, y);
        ctx.arc(x, y, radius, 0, Math.PI * 2);
      }
      ctx.fillStyle = airportTypeColors[kind]!;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const scheduledRadius = Math.max(1.7, 3.0 * zoomSize);
    ctx.beginPath();
    for (const point of records) {
      if (!point.scheduled) continue;
      const [x, y] = projectNormalized(point.x, point.y, baseView);
      ctx.moveTo(x + scheduledRadius, y);
      ctx.arc(x, y, scheduledRadius, 0, Math.PI * 2);
    }
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,244,212,.88)';
    ctx.stroke();
  }

  function draw() {
    if (!viewport.width || !viewport.height) return;
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    context!.fillStyle = '#101d28';
    context!.fillRect(0, 0, viewport.width, viewport.height);
    context!.imageSmoothingEnabled = true;
    context!.imageSmoothingQuality = 'high';
    const width = viewport.width * view.zoom, height = viewport.height * view.zoom;
    const left = (viewport.width - width) / 2 + view.panX;
    const top = (viewport.height - height) / 2 + view.panY;
    context!.drawImage(staticCanvas, left, top, width, height);
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    viewport.width = canvas.clientWidth;
    viewport.height = canvas.clientHeight;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    staticCanvas.width = canvas.width;
    staticCanvas.height = canvas.height;
    paintStatic();
    draw();
  }
  canvas.addEventListener('pointerdown', (event) => {
    drag = [event.clientX, event.clientY];
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    Object.assign(view, panBy(view, event.clientX - drag[0], event.clientY - drag[1]));
    drag = [event.clientX, event.clientY];
    draw();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    Object.assign(view, zoomAt(view, Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top, viewport));
    draw();
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { Object.assign(view, initialView()); draw(); });
  new ResizeObserver(resize).observe(canvas);
  resize();

  return {
    canvas, context, view, viewport, records, stats, land, draw, projectedLonLat,
    firstFrameMs: performance.now() - started,
    airportBytes: airportBuffer.byteLength,
  };
}
