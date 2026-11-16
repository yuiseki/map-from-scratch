import {
  decodeEventRows, filterEventsThrough, hitTestEvent, projectLongitudeLatitude, seismicGlyph,
  sortEventsByTime, type EarthquakeEvent, type ScreenEvent,
} from './field.ts';
import { createWebGLRings, type WebGLRings } from './webgl.ts';

type Coastlines = [number, number][][];
interface Stats {
  source: { count: number; uniqueIds: number; eventIdSha256: string; firstTime: number; lastTime: number; magnitudeRange: number[]; depthRangeKm: number[] };
  context: { features: number; antimeridianSplitCoastlineParts: number };
  output: { events: number; eventBytes: number; coastlineParts: number; coastlineBytes: number };
  interpretation: string;
}
interface Camera { centerX: number; centerY: number; zoom: number }
export interface QuakeRenderer {
  canvas: HTMLCanvasElement;
  marksCanvas: HTMLCanvasElement;
  data: { events: EarthquakeEvent[]; coastlines: Coastlines; stats: Stats };
  state: Camera;
  firstFrameMs: number;
  draw(): void;
  render(): void;
  screenPoint(event: EarthquakeEvent): [number, number];
  setCutoffIndex(index: number): void;
  selectIndex(index: number): void;
  resetView(): void;
}

export async function mount(
  canvas: HTMLCanvasElement,
  marksCanvas: HTMLCanvasElement,
  base: string,
  onSelection: (event: EarthquakeEvent, index: number, visibleCount: number) => void,
): Promise<QuakeRenderer> {
  const started = performance.now();
  const [eventsUnknown, coastUnknown, stats] = await Promise.all([
    fetch(`${base}/events.json`).then((response) => { if (!response.ok) throw new Error(`events.json: HTTP ${response.status}`); return response.json(); }),
    fetch(`${base}/coastlines.json`).then((response) => { if (!response.ok) throw new Error(`coastlines.json: HTTP ${response.status}`); return response.json(); }),
    fetch(`${base}/stats.json`).then((response) => { if (!response.ok) throw new Error(`stats.json: HTTP ${response.status}`); return response.json(); }),
  ]) as [EarthquakeEvent[], Coastlines, Stats];
  const events = sortEventsByTime(decodeEventRows(eventsUnknown));
  if (events.length !== 8_502 || stats.source.count !== 8_502 || stats.source.uniqueIds !== 8_502 || stats.output.events !== 8_502) throw new Error('Frozen source count does not equal 8,502 events');
  if (coastUnknown.length !== stats.output.coastlineParts) throw new Error('Coastline payload and source statistics disagree');
  const ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  const data = { events, coastlines: coastUnknown, stats };
  const state: Camera = { centerX: 0, centerY: 0.5, zoom: 1 };
  const eventPositions = new Map(events.map((event) => [event, projectLongitudeLatitude(event.longitude, event.latitude)]));
  const rings: WebGLRings = createWebGLRings(marksCanvas, events);
  let cutoff = events.length - 1;
  let scheduled = false;
  let firstFrameMs = 0;
  const worldScale = () => Math.min(canvas.width * 0.92, canvas.height * 1.84) * state.zoom;
  const screenPointProjected = (point: { x: number; y: number }): [number, number] => {
    const scale = worldScale();
    return [canvas.width / 2 + (point.x - state.centerX) * scale,
      canvas.height / 2 + (point.y - state.centerY) * scale];
  };
  const screenPoint = (event: EarthquakeEvent): [number, number] => {
    return screenPointProjected(eventPositions.get(event)!);
  };

  function screenPointLonLat(longitude: number, latitude: number): [number, number] {
    return screenPointProjected(projectLongitudeLatitude(longitude, latitude));
  }

  function line(points: readonly (readonly [number, number])[]) {
    if (points.length < 2) return;
    const first = screenPointLonLat(points[0]![0], points[0]![1]);
    ctx!.moveTo(first[0], first[1]);
    for (let i = 1; i < points.length; i++) {
      const p = screenPointLonLat(points[i]![0], points[i]![1]);
      ctx!.lineTo(p[0], p[1]);
    }
  }

  function drawContext() {
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    ctx!.lineWidth = Math.max(0.55, canvas.width / 2400);
    ctx!.strokeStyle = 'rgba(102, 143, 166, .2)';
    for (let latitude = -75; latitude <= 75; latitude += 15) {
      ctx!.beginPath();
      for (let longitude = -180; longitude <= 180; longitude += 3) {
        const point = screenPointLonLat(longitude, latitude);
        if (longitude === -180) ctx!.moveTo(...point); else ctx!.lineTo(...point);
      }
      ctx!.stroke();
    }
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      ctx!.beginPath();
      for (let latitude = -90; latitude <= 90; latitude += 3) {
        const point = screenPointLonLat(longitude, latitude);
        if (latitude === -90) ctx!.moveTo(...point); else ctx!.lineTo(...point);
      }
      ctx!.stroke();
    }
    ctx!.beginPath();
    for (const ring of data.coastlines) line(ring);
    ctx!.lineWidth = Math.max(0.65, canvas.width / 1800);
    ctx!.strokeStyle = 'rgba(210, 228, 215, .58)'; ctx!.stroke();
    ctx!.beginPath();
    const equatorStart = screenPointLonLat(-180, 0), equatorEnd = screenPointLonLat(180, 0);
    ctx!.moveTo(...equatorStart); ctx!.lineTo(...equatorEnd);
    ctx!.lineWidth = Math.max(0.75, canvas.width / 1600); ctx!.strokeStyle = 'rgba(199, 223, 229, .5)'; ctx!.stroke();
    ctx!.save();
    ctx!.font = `${Math.max(9, canvas.width / 150)}px ui-monospace, monospace`;
    ctx!.fillStyle = 'rgba(190, 208, 213, .72)';
    ctx!.textAlign = 'center'; ctx!.textBaseline = 'top';
    for (let longitude = -180; longitude <= 180; longitude += 30) {
      const label = longitude === 0 ? '0°' : `${Math.abs(longitude)}°${longitude < 0 ? 'W' : 'E'}`;
      const point = screenPointLonLat(longitude, 0);
      ctx!.fillText(label, point[0], point[1] + Math.max(4, canvas.width / 220));
    }
    ctx!.textAlign = 'left'; ctx!.textBaseline = 'middle';
    for (let latitude = -60; latitude <= 60; latitude += 30) {
      const label = latitude === 0 ? '0°' : `${Math.abs(latitude)}°${latitude < 0 ? 'S' : 'N'}`;
      const point = screenPointLonLat(-180, latitude);
      ctx!.fillText(label, point[0] + Math.max(4, canvas.width / 220), point[1]);
    }
    ctx!.restore();
  }

  function drawSelection(event: EarthquakeEvent | undefined) {
    if (!event) return;
    const [x, y] = screenPoint(event);
    const radius = Math.min(44, seismicGlyph(event.magnitude, event.depthKm).outerRadius * Math.sqrt(state.zoom));
    ctx!.save(); ctx!.strokeStyle = '#fff8d6'; ctx!.lineWidth = 1.6; ctx!.setLineDash([3, 3]);
    ctx!.beginPath(); ctx!.arc(x, y, radius + 3, 0, Math.PI * 2); ctx!.stroke(); ctx!.setLineDash([]);
    ctx!.beginPath(); ctx!.moveTo(x - 7, y); ctx!.lineTo(x + 7, y); ctx!.moveTo(x, y - 7); ctx!.lineTo(x, y + 7); ctx!.stroke();
    ctx!.restore();
  }

  function draw() {
    if (!canvas.width || !canvas.height) return;
    drawContext();
    const event = events[cutoff]!;
    rings.draw({ ...state, scale: worldScale() }, cutoff, cutoff);
    drawSelection(event);
    if (!firstFrameMs) firstFrameMs = performance.now() - started;
  }
  function render() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; draw(); });
  }
  function selectIndex(index: number) {
    cutoff = Math.max(0, Math.min(events.length - 1, Math.round(index)));
    const selected = events[cutoff]!;
    onSelection(selected, cutoff, filterEventsThrough(events, selected.time).length);
    render();
  }
  const setCutoffIndex = (index: number) => selectIndex(index);
  function resetView() { state.centerX = 0; state.centerY = 0.5; state.zoom = 1; render(); }

  let drag: { x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  const devicePoint = (event: PointerEvent | WheelEvent): [number, number] => {
    const rect = canvas.getBoundingClientRect();
    return [(event.clientX - rect.left) * devicePixelRatio, (event.clientY - rect.top) * devicePixelRatio];
  };
  canvas.addEventListener('pointerdown', (event) => {
    const [x, y] = devicePoint(event); drag = { x, y, startX: x, startY: y, moved: false };
    // Synthetic pointer events used by the browser checks have no active OS
    // pointer to capture; trusted events retain normal drag capture behavior.
    if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const [x, y] = devicePoint(event), dx = x - drag.x, dy = y - drag.y;
    if (Math.hypot(x - drag.startX, y - drag.startY) > 4) drag.moved = true;
    if (!drag.moved) return;
    const scale = worldScale(); state.centerX -= dx / scale; state.centerY -= dy / scale;
    drag.x = x; drag.y = y; render();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    if (!drag.moved) {
      const [x, y] = devicePoint(event);
      const points: ScreenEvent[] = events.slice(0, cutoff + 1).map((quake) => {
        const [screenX, screenY] = screenPoint(quake); return { event: quake, x: screenX, y: screenY };
      });
      const hit = hitTestEvent(x, y, points, Math.max(10, 12 * devicePixelRatio));
      if (hit) selectIndex(events.indexOf(hit.event));
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); state.zoom = Math.max(0.7, Math.min(8, state.zoom * Math.exp(-event.deltaY * 0.0012))); render();
  }, { passive: false });
  const resize = () => {
    canvas.width = Math.round(canvas.clientWidth * devicePixelRatio);
    canvas.height = Math.round(canvas.clientHeight * devicePixelRatio);
    rings.resize();
    draw();
  };
  resize(); new ResizeObserver(resize).observe(canvas);
  selectIndex(cutoff);
  return { canvas, marksCanvas, data, state, get firstFrameMs() { return firstFrameMs; }, draw, render, screenPoint, setCutoffIndex, selectIndex, resetView };
}
