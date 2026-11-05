import { decodeCountryGeometry, type PackedCountry } from './geometry.ts';
import { decodeAccessSeries } from './power.ts';

export interface PowerStats {
  sourceDate: string; indicator: string; startYear: number; endYear: number; sourceCountryCount: number;
  renderedCountryCount: number; joinedByYear: number[]; polygonCount: number; ringCount: number; pointCount: number;
  geometryBytes: number; accessBytes: number; attribution: string;
}
export interface CountryValue { iso3: string; name: string; label: [number, number]; values: (number | null)[] }
export interface PowerMap {
  canvas: HTMLCanvasElement;
  countries: CountryValue[];
  stats: PowerStats;
  year: number;
  view: { zoom: number; panX: number; panY: number };
  firstFrameMs: number;
  draw(): void;
  setYear(year: number): void;
  whenYearRendered(year: number): Promise<number>;
  worldToScreen(x: number, y: number): { x: number; y: number };
  screenForCountry(iso3: string): { x: number; y: number } | null;
  value(iso3: string, year: number): number | null;
}

const ASPECT = 2.055;
const ocean = '#09151e';

export async function mount(canvas: HTMLCanvasElement, base: string): Promise<PowerMap> {
  const started = performance.now();
  const [countryResponse, geometryResponse, accessResponse, statsResponse] = await Promise.all([
    fetch(`${base}/countries.json`), fetch(`${base}/geometry.bin`), fetch(`${base}/access.bin`), fetch(`${base}/stats.json`),
  ]);
  if (!countryResponse.ok || !geometryResponse.ok || !accessResponse.ok || !statsResponse.ok) {
    throw new Error(`Power map data unavailable (${countryResponse.status}, ${geometryResponse.status}, ${accessResponse.status}, ${statsResponse.status})`);
  }
  const [metadata, geometryBuffer, accessBuffer, stats] = await Promise.all([
    countryResponse.json() as Promise<PackedCountry[]>, geometryResponse.arrayBuffer(), accessResponse.arrayBuffer(), statsResponse.json() as Promise<PowerStats>,
  ]);
  const decoded = decodeCountryGeometry(geometryBuffer, metadata), series = decodeAccessSeries(accessBuffer);
  if (series.startYear !== stats.startYear || series.yearCount !== stats.endYear - stats.startYear + 1 || series.records.length !== decoded.length) {
    throw new Error('Country geometry and WDI table dimensions do not match');
  }
  const countries: CountryValue[] = decoded.map((shape, index) => {
    const record = series.records[index]!;
    if (shape.iso3 !== record.iso3) throw new Error(`Country order mismatch: ${shape.iso3} / ${record.iso3}`);
    return { iso3: shape.iso3, name: shape.name, label: [shape.label[0]!, shape.label[1]!], values: record.values };
  });
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const ctx = context;
  const view = { zoom: 1, panX: 0, panY: 0 };
  let year = stats.endYear, bitmap: ImageBitmap | null = null, renderedYear = -1;
  const waiters = new Map<number, ((elapsedMs: number) => void)[]>();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const frame = () => {
    const height = Math.min(canvas.clientHeight * 0.86, canvas.clientWidth * 0.92 / ASPECT) * view.zoom;
    const width = height * ASPECT;
    return { left: (canvas.clientWidth - width) / 2 + view.panX, top: (canvas.clientHeight - height) / 2 + view.panY, width, height };
  };
  const worldToScreen = (x: number, y: number) => {
    const box = frame(); return { x: box.left + x * box.width, y: box.top + y * box.height };
  };
  const screenToWorld = (x: number, y: number) => {
    const box = frame(); return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
  };
  function draw() {
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = ocean; ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if (bitmap) { const box = frame(); ctx.imageSmoothingEnabled = true; ctx.drawImage(bitmap, box.left, box.top, box.width, box.height); }
  }
  const map: PowerMap = {
    canvas, countries, stats, year, view, firstFrameMs: 0, draw,
    setYear(value) {
      year = Math.max(stats.startYear, Math.min(stats.endYear, Math.round(value))); map.year = year;
      worker.postMessage({ type: 'year', year }); draw();
    },
    whenYearRendered(target) {
      if (renderedYear === target) return Promise.resolve(0);
      return new Promise((resolve) => { const pending = waiters.get(target) ?? []; pending.push(resolve); waiters.set(target, pending); });
    },
    worldToScreen,
    screenForCountry(iso3) { const country = countries.find((item) => item.iso3 === iso3); return country ? worldToScreen(country.label[0], country.label[1]) : null; },
    value(iso3, atYear) { const country = countries.find((item) => item.iso3 === iso3); return country?.values[atYear - stats.startYear] ?? null; },
  };
  const worker = new Worker(new URL('./renderer.worker.ts', import.meta.url), { type: 'module' });
  let rejectInitial: (error: Error) => void = () => {};
  const firstRender = new Promise<void>((resolve, reject) => {
    rejectInitial = reject;
    worker.onmessage = (event: MessageEvent) => {
      const message = event.data as { type: string; year?: number; bitmap?: ImageBitmap; renderMs?: number; message?: string };
      if (message.type === 'error') { rejectInitial(new Error(message.message)); return; }
      if (message.type !== 'rendered' || !message.bitmap || message.year === undefined) return;
      if (message.year !== year) { message.bitmap.close(); return; }
      bitmap?.close(); bitmap = message.bitmap; renderedYear = message.year; draw();
      for (const [target, callbacks] of waiters) {
        if (target === renderedYear) { callbacks.forEach((callback) => callback(message.renderMs ?? 0)); waiters.delete(target); }
      }
      resolve();
    };
    worker.onerror = (event) => rejectInitial(new Error(event.message || 'Power map worker failed'));
  });
  const initialWidth = Math.max(1, Math.min(4096, Math.round(Math.min(canvas.clientHeight * 0.86, canvas.clientWidth * 0.92 / ASPECT) * ASPECT * dpr * 2)));
  worker.postMessage({ type: 'init', metadata, geometryBuffer, accessBuffer, stats, width: initialWidth, height: Math.round(initialWidth / ASPECT) }, [geometryBuffer, accessBuffer]);
  await firstRender;
  worker.onerror = (event) => { console.error(event.message || 'Power map worker failed'); };
  map.firstFrameMs = performance.now() - started;
  draw();
  let drag: { x: number; y: number; panX: number; panY: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || !(event.buttons & 1)) return;
    view.panX = drag.panX + event.clientX - drag.x; view.panY = drag.panY + event.clientY - drag.y; draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const anchor = screenToWorld(x, y); view.zoom = Math.max(0.8, Math.min(8, view.zoom * Math.exp(-event.deltaY * 0.001)));
    const moved = worldToScreen(anchor.x, anchor.y); view.panX += x - moved.x; view.panY += y - moved.y; draw();
  }, { passive: false });
  new ResizeObserver(() => {
    const width = Math.max(1, Math.min(4096, Math.round(Math.min(canvas.clientHeight * 0.86, canvas.clientWidth * 0.92 / ASPECT) * ASPECT * dpr * 2)));
    worker.postMessage({ type: 'resize', width, height: Math.round(width / ASPECT) }); draw();
  }).observe(canvas);
  return map;
}
