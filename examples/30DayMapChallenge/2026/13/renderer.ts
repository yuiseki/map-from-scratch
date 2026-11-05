import { decodeMobilityFrame, flowOffset, type Municipality } from './mobility.ts';

type GeoFeature = { geometry: { type: string; coordinates: unknown } | null };
type Stats = { years: number[]; municipalityCount: number; prefectureCount: number; sourceVintage: string; totalGzipBytes: number; maxMonthGzipBytes: number; monthlyBytes: Record<string, number> };
export interface FlowMap {
  readonly dataset: { municipalities: Municipality[]; years: number[] };
  readonly stats: Stats;
  readonly firstFrameMs: number;
  readonly activeFrameBytes: number;
  readonly state: { panX: number; panY: number; zoom: number; year: number; month: number; dayType: number; timezone: number; selected: number };
  draw(): void;
  setFrame(year: number, month: number): Promise<void>;
  hitTest(x: number, y: number): number;
  screenPoint(city: Municipality): [number, number];
  values(cityIndex: number): number[];
  selectedMunicipality(): Municipality | null;
  select(index: number): void;
}

const CATEGORIES = ['同じ市区町村', '同じ都道府県内の別市区町村', '同じ地方ブロック内の別都道府県', '別の地方ブロック'] as const;
const CATEGORY_COLORS = ['#70dfc3', '#66b7ef', '#ffc46b', '#ff797c'];
const MONTH_COUNT = 12;
const clamp = (x: number, min: number, max: number) => Math.max(min, Math.min(max, x));
const projection = (lon: number, lat: number): [number, number] => [lon * Math.cos(37 * Math.PI / 180), -lat];

export async function mount(canvas: HTMLCanvasElement, base: string): Promise<FlowMap> {
  const started = performance.now();
  const [municipalities, prefectures, stats] = await Promise.all([
    fetch(`${base}/municipalities.json`).then(async (r) => { if (!r.ok) throw new Error(`municipalities: HTTP ${r.status}`); return r.json() as Promise<Municipality[]> }),
    fetch(`${base}/prefectures.json`).then(async (r) => { if (!r.ok) throw new Error(`prefectures: HTTP ${r.status}`); return r.json() as Promise<{ features: GeoFeature[] }> }),
    fetch(`${base}/stats.json`).then(async (r) => { if (!r.ok) throw new Error(`stats: HTTP ${r.status}`); return r.json() as Promise<Stats> }),
  ]);
  if (municipalities.length !== stats.municipalityCount || stats.years.join(',') !== '2019,2020,2021') throw new Error('mobility manifest mismatch');
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  const prefecturePaths: Path2D[] = [];
  for (const feature of prefectures.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const coords = geometry.coordinates as unknown;
    const polys = geometry.type === 'Polygon' ? [coords] : geometry.type === 'MultiPolygon' ? coords as unknown[] : [];
    for (const poly of polys as number[][][][]) {
      const path = new Path2D();
      for (const ring of poly) {
        if (ring.length < 3) continue;
        ring.forEach(([lon, lat], index) => { if (index === 0) path.moveTo(lon, lat); else path.lineTo(lon, lat); });
        path.closePath();
      }
      prefecturePaths.push(path);
    }
  }
  const dataset = { municipalities, years: stats.years };
  const state = { panX: 0, panY: 0, zoom: 1, year: 2, month: 10, dayType: 2, timezone: 0, selected: -1 };
  let dpr = Math.min(2, window.devicePixelRatio || 1);
  let mapRect = { left: 0, top: 0, width: canvas.clientWidth, height: canvas.clientHeight };
  let activeFlows: Uint32Array<ArrayBufferLike> = new Uint32Array(dataset.municipalities.length * 3 * 3 * 4);
  let activeFrameBytes = 0, frameSequence = 0;
  const frameCache = new Map<string, Promise<Uint32Array>>();
  const loadFrame = (year: number, month: number) => {
    const key = `${dataset.years[year]}-${String(month + 1).padStart(2, '0')}`;
    let cached = frameCache.get(key);
    if (!cached) {
      cached = (async () => {
        const response = await fetch(`${base}/frames/${key}.bin.gz`);
        if (!response.ok) throw new Error(`mobility frame ${key}: HTTP ${response.status}`);
        const compressed = await response.arrayBuffer();
        const bytes = await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        const frame = decodeMobilityFrame(bytes);
        if (frame.year !== dataset.years[year] || frame.month !== month || frame.municipalityCount !== dataset.municipalities.length) throw new Error(`mobility frame ${key} does not match index`);
        return frame.flows;
      })();
      frameCache.set(key, cached);
      void cached.catch(() => frameCache.delete(key));
    }
    return { key, promise: cached };
  };
  const mapWidth = () => mapRect.width;
  const bounds = { minX: 122, maxX: 147, minY: -47, maxY: -24 };
  const fitScale = () => Math.min(mapWidth() / ((bounds.maxX - bounds.minX) * Math.cos(37 * Math.PI / 180)), mapRect.height / (bounds.maxY - bounds.minY)) * 0.92;
  const screenPoint = (city: Municipality): [number, number] => {
    const [x, y] = projection(city.lon, city.lat), scale = fitScale() * state.zoom;
    return [mapWidth() / 2 + state.panX + (x - (bounds.minX + bounds.maxX) * Math.cos(37 * Math.PI / 180) / 2) * scale,
      mapRect.height / 2 + state.panY + (y - (bounds.minY + bounds.maxY) / 2) * scale];
  };
  const values = (cityIndex: number) => [0, 1, 2, 3].map((area) => activeFlows[flowOffset(cityIndex, state.dayType, state.timezone, area)]!);
  const selectedMunicipality = () => dataset.municipalities[state.selected] ?? null;
  const draw = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(canvas.clientWidth * dpr), height = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    mapRect = { left: canvas.getBoundingClientRect().left, top: canvas.getBoundingClientRect().top, width: canvas.clientWidth, height: canvas.clientHeight };
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#101e27'; ctx.fillRect(0, 0, mapRect.width, mapRect.height);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, mapWidth(), mapRect.height); ctx.clip();
    ctx.strokeStyle = '#ffffff10'; ctx.lineWidth = 1;
    for (let lat = 25; lat <= 47; lat += 5) { const y = screenPoint({ lon: 137, lat, code: '', name: '', prefecture: '' })[1]; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(mapWidth(), y); ctx.stroke(); }
    const scale = fitScale() * state.zoom, offsetX = mapWidth() / 2 + state.panX - (bounds.minX + bounds.maxX) * Math.cos(37 * Math.PI / 180) / 2 * scale;
    const offsetY = mapRect.height / 2 + state.panY - (bounds.minY + bounds.maxY) / 2 * scale;
    ctx.save(); ctx.translate(offsetX, offsetY); ctx.scale(scale * Math.cos(37 * Math.PI / 180), -scale);
    ctx.fillStyle = '#263f45'; ctx.strokeStyle = '#80aeb04a'; ctx.lineWidth = 0.13 / state.zoom;
    for (const path of prefecturePaths) { ctx.fill(path, 'evenodd'); ctx.stroke(path); }
    ctx.restore();
    let drawn = 0;
    for (let i = 0; i < dataset.municipalities.length; i++) {
      const city = dataset.municipalities[i]!, screen = screenPoint(city);
      if (screen[0] < -12 || screen[0] > mapWidth() + 12 || screen[1] < -12 || screen[1] > mapRect.height + 12) continue;
      const base = flowOffset(i, state.dayType, state.timezone, 0);
      const local = activeFlows[base]!, total = local + activeFlows[base + 1]! + activeFlows[base + 2]! + activeFlows[base + 3]!;
      if (!total) continue;
      const external = 1 - local / total;
      const radius = clamp(1.2 + Math.log1p(total) * 0.42, 1.5, 5.5) * Math.min(1.25, Math.sqrt(state.zoom));
      const red = Math.round(112 + external * 142), green = Math.round(221 - external * 105), blue = Math.round(195 - external * 53);
      ctx.beginPath(); ctx.arc(screen[0], screen[1], radius, 0, Math.PI * 2); ctx.fillStyle = `rgba(${red},${green},${blue},0.82)`; ctx.fill();
      if (i === state.selected) { ctx.beginPath(); ctx.arc(screen[0], screen[1], radius + 4, 0, Math.PI * 2); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.7; ctx.stroke(); }
      drawn++;
    }
    ctx.restore();
    ctx.fillStyle = '#cfdee0'; ctx.font = '12px system-ui, sans-serif'; ctx.fillText(`${drawn.toLocaleString()} 市区町村 · ${dataset.years[state.year]}年 ${String(state.month + 1).padStart(2, '0')}月`, 18, mapRect.height - 22);
  };
  const hitTest = (x: number, y: number) => {
    let winner = -1, min = 13 * 13;
    for (let i = 0; i < dataset.municipalities.length; i++) {
      const point = screenPoint(dataset.municipalities[i]!); if (point[0] < 0 || point[0] > mapWidth() || point[1] < 0 || point[1] > mapRect.height) continue;
      const dist = (point[0] - x) ** 2 + (point[1] - y) ** 2;
      if (dist < min) { min = dist; winner = i; }
    }
    return winner;
  };
  const setFrame = async (year: number, month: number) => {
    if (year < 0 || year >= dataset.years.length || month < 0 || month >= MONTH_COUNT) throw new RangeError('invalid mobility month');
    state.year = year; state.month = month;
    const sequence = ++frameSequence, frame = loadFrame(year, month);
    const flows = await frame.promise;
    if (sequence === frameSequence) { activeFlows = flows; activeFrameBytes = stats.monthlyBytes[frame.key] ?? 0; draw(); }
  };
  let drag: { x: number; y: number; startX: number; startY: number; moved: boolean } | null = null;
  canvas.addEventListener('pointerdown', (event) => {
    drag = { x: event.clientX, y: event.clientY, startX: state.panX, startY: state.panY, moved: false }; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    state.panX = drag.startX + dx; state.panY = drag.startY + dy; draw();
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag) return;
    if (!drag.moved) { const i = hitTest(event.clientX, event.clientY); if (i >= 0) { state.selected = i; canvas.dispatchEvent(new CustomEvent('municipality-select', { detail: { index: i } })); } }
    drag = null; draw();
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); state.zoom = clamp(state.zoom * Math.exp(-event.deltaY * 0.001), 0.7, 8); draw(); }, { passive: false });
  const resize = new ResizeObserver(draw); resize.observe(canvas);
  state.selected = dataset.municipalities.findIndex((city) => city.code === '13106');
  const initialFrame = loadFrame(state.year, state.month);
  const initialFlows = await initialFrame.promise;
  activeFlows = initialFlows; activeFrameBytes = stats.monthlyBytes[initialFrame.key] ?? 0; draw();
  return { dataset, stats, get activeFrameBytes() { return activeFrameBytes; }, firstFrameMs: performance.now() - started, state, draw, setFrame, hitTest, screenPoint, values, selectedMunicipality, select(index) { if (index >= 0 && index < dataset.municipalities.length) { state.selected = index; draw(); } } };
}

export { CATEGORIES, CATEGORY_COLORS };
