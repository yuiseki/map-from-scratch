import { decodeFoodFeatures, foodDetailLevel, groupFoodFeatures, hitTestFoodFeature, normalizeCellCount, projectFoodPoint, type FoodCategory, type FoodFeature, type FoodGridCell } from './taste.ts';

interface FoodData { release: string; crs: string; bounds: { minX: number; minY: number; maxX: number; maxY: number }; gridCellMeters: number; features: FoodFeature[]; grid: FoodGridCell[] }
const colors: Record<FoodCategory, string> = { eatery: '#e65e47', cafe: '#eaa33a', drinks: '#5678b8', 'food-shop': '#2b9a83' };
const labels: Record<FoodCategory, string> = { eatery: '食事', cafe: '喫茶', drinks: '酒場', 'food-shop': '食料品店' };
const allCategories: FoodCategory[] = ['eatery', 'cafe', 'drinks', 'food-shop'];

export interface TasteRenderer {
  readonly zoomLevel: number;
  setZoom(factor: number): void;
  resetView(): void;
  setCategory(category: FoodCategory, enabled: boolean): void;
  readonly featureCount: number;
  readonly pointCount: number;
  readonly areaCount: number;
  readonly gridCellCount: number;
  readonly cuisineTaggedCount: number;
  readonly cuisineUnspecifiedCount: number;
  readonly visibleCount: number;
  readonly firstFrameMs: number;
  readonly canvas: HTMLCanvasElement;
  readonly inspectionFeatureId: string;
  draw(): void;
  screenPoint(featureId: string): { x: number; y: number } | null;
  dispose(): void;
}

export async function mount(canvas: HTMLCanvasElement, base: string): Promise<TasteRenderer> {
  const started = performance.now();
  const response = await fetch(`${base}/taste.json`);
  if (!response.ok) throw new Error(`Food dataset request failed: HTTP ${response.status}`);
  const raw = await response.json() as Partial<FoodData>;
  if (raw.release !== '2026-08-31' || raw.crs !== 'EPSG:3857' || !raw.bounds || !Array.isArray(raw.features) || !Array.isArray(raw.grid)) throw new Error('Unexpected frozen food dataset');
  const features = decodeFoodFeatures(raw.features);
  const groupedFeatures = groupFoodFeatures(features);
  const cells = raw.grid;
  const bounds = raw.bounds;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  const selected = document.getElementById('selection')!;
  const status = document.getElementById('map-status')!;
  const scaleLabel = document.getElementById('scale-label')!;
  const coordLabel = document.getElementById('coordinate')!;
  const active = new Set<FoodCategory>(allCategories);
  const initial = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  let inspectionFeatureId = features[0]!.id;
  const view = { ...initial, scale: 1, width: 1, height: 1 };
  let dpr = 1, raf = 0, dragging = false, pointerX = 0, pointerY = 0, pointerStartX = 0, pointerStartY = 0;
  let zoomLevel = 1, disposed = false;

  const fit = () => {
    const width = Math.max(1, canvas.clientWidth), height = Math.max(1, canvas.clientHeight);
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    view.width = width; view.height = height;
    view.scale = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY)) * 0.88 * zoomLevel;
    inspectionFeatureId = features.reduce((best, feature) =>
      Math.hypot(feature.x - view.x, feature.y - view.y) < Math.hypot(best.x - view.x, best.y - view.y) ? feature : best, features[0]!).id;
    draw();
  };
  const project = (x: number, y: number) => projectFoodPoint(x, y, view);
  const drawGeometry = (feature: FoodFeature) => {
    if (!feature.geometry) return;
    const paintPolygon = (rings: unknown) => {
      if (!Array.isArray(rings)) return;
      ctx.beginPath();
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 2) continue;
        ring.forEach((coordinate, index) => {
          if (!Array.isArray(coordinate) || coordinate.length < 2) return;
          const point = project(Number(coordinate[0]), Number(coordinate[1]));
          if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = `${colors[feature.category]}22`; ctx.strokeStyle = colors[feature.category]; ctx.lineWidth = 1.25; ctx.fill('evenodd'); ctx.stroke();
    };
    if (feature.geometry.type === 'Polygon') paintPolygon(feature.geometry.coordinates);
    else if (Array.isArray(feature.geometry.coordinates)) for (const polygon of feature.geometry.coordinates) paintPolygon(polygon);
  };
  const draw = () => {
    if (disposed) return;
    const scale = dpr;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#f2efe8'; ctx.fillRect(0, 0, view.width, view.height);

    // Fine geographic paper grid is only context; food features remain the map's subject.
    const gridStep = view.scale * 1000;
    if (gridStep >= 44) {
      const left = view.x - view.width / 2 / view.scale, right = view.x + view.width / 2 / view.scale;
      const bottom = view.y - view.height / 2 / view.scale, top = view.y + view.height / 2 / view.scale;
      ctx.strokeStyle = '#d9d2c4'; ctx.lineWidth = 0.7; ctx.setLineDash([2, 5]); ctx.beginPath();
      for (let x = Math.floor(left / 1000) * 1000; x <= right; x += 1000) { const p = project(x, view.y); ctx.moveTo(p.x, 0); ctx.lineTo(p.x, view.height); }
      for (let y = Math.floor(bottom / 1000) * 1000; y <= top; y += 1000) { const p = project(view.x, y); ctx.moveTo(0, p.y); ctx.lineTo(view.width, p.y); }
      ctx.stroke(); ctx.setLineDash([]);
    }
    const enabledCount = features.filter((feature) => active.has(feature.category)).length;
    const detail = foodDetailLevel(view.scale);
    if (detail === 'grid') {
      const tileSize = (raw.gridCellMeters ?? 220) * view.scale;
      let maximum = 1;
      for (const cell of cells) for (const category of allCategories) if (active.has(category)) maximum = Math.max(maximum, cell.categories[category]);
      for (const cell of cells) {
        const counts = allCategories.map((category) => active.has(category) ? cell.categories[category] : 0);
        if (!counts.some(Boolean)) continue;
        const x = cell.x * (raw.gridCellMeters ?? 220), y = cell.y * (raw.gridCellMeters ?? 220), point = project(x, y);
        const half = tileSize / 2, gap = Math.max(0.4, Math.min(1.5, tileSize * 0.045));
        for (let index = 0; index < 4; index++) {
          const count = counts[index]!;
          if (!count) continue;
          ctx.globalAlpha = 0.35 + 0.65 * Math.sqrt(normalizeCellCount(count, maximum));
          ctx.fillStyle = colors[allCategories[index]!];
          const qx = point.x - half + (index % 2) * half, qy = point.y - half + Math.floor(index / 2) * half;
          ctx.fillRect(qx + gap / 2, qy + gap / 2, half - gap, half - gap);
        }
        ctx.globalAlpha = 1;
        if (tileSize >= 25) {
          ctx.strokeStyle = '#fff8'; ctx.lineWidth = 0.6; ctx.strokeRect(point.x - half, point.y - half, tileSize, tileSize);
        }
      }
    } else {
      if (detail === 'geometry') for (const category of allCategories) {
        if (active.has(category)) for (const feature of groupedFeatures[category]) drawGeometry(feature);
      }
      const radius = Math.max(1.5, Math.min(6, 2.2 + Math.log2(view.scale / 0.11 + 1)));
      for (const category of allCategories) {
        if (!active.has(category)) continue;
        ctx.beginPath();
        for (const feature of groupedFeatures[category]) {
          const point = project(feature.x, feature.y);
          if (point.x < -radius || point.y < -radius || point.x > view.width + radius || point.y > view.height + radius) continue;
          ctx.moveTo(point.x + radius, point.y);
          ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        }
        ctx.fillStyle = colors[category]; ctx.fill();
      }
    }

    // Context labels are place names, not OSM food features.
    ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'; ctx.fillStyle = '#726b60';
    for (const place of [{ name: '上野', x: 15_561_050, y: 4_261_550 }, { name: '浅草', x: 15_563_000, y: 4_261_700 }]) {
      const p = project(place.x, place.y); ctx.fillText(place.name, p.x + 7, p.y - 8);
    }
    const centerLat = 2 * Math.atan(Math.exp(view.y / 6_378_137)) - Math.PI / 2;
    const niceM = 500 * Math.pow(2, Math.floor(Math.log2(Math.max(0.1, 130 / (view.scale * Math.cos(centerLat) * 500)))));
    document.querySelector<HTMLElement>('.scale')!.style.setProperty('--scale-width', `${niceM / Math.cos(centerLat) * view.scale}px`);
    scaleLabel.textContent = niceM >= 1000 ? `${(niceM / 1000).toFixed(niceM % 1000 ? 1 : 0)} km` : `${Math.round(niceM)} m`;
    status.textContent = `${enabledCount.toLocaleString('ja-JP')} 件表示 · ${features.length.toLocaleString('ja-JP')} 件のタグ付き場所`;
  };
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };
  const setZoom = (factor: number) => { if (!Number.isFinite(factor) || factor <= 0) return; zoomLevel = Math.max(0.5, Math.min(8, zoomLevel * factor)); fit(); };
  const onWheel = (event: WheelEvent) => { event.preventDefault(); const factor = event.deltaY < 0 ? 1.18 : 1 / 1.18; setZoom(factor); };
  const onPointerDown = (event: PointerEvent) => { dragging = true; pointerX = event.clientX; pointerY = event.clientY; pointerStartX = event.clientX; pointerStartY = event.clientY; if (event.isTrusted) canvas.setPointerCapture(event.pointerId); };
  const onPointerMove = (event: PointerEvent) => {
    if (dragging) { view.x -= (event.clientX - pointerX) / view.scale; view.y += (event.clientY - pointerY) / view.scale; pointerX = event.clientX; pointerY = event.clientY; schedule(); }
    const rect = canvas.getBoundingClientRect(), mx = event.clientX - rect.left, my = event.clientY - rect.top;
    const mercatorX = view.x + (mx - view.width / 2) / view.scale, mercatorY = view.y - (my - view.height / 2) / view.scale;
    const lon = mercatorX / 6_378_137 * 180 / Math.PI, lat = (2 * Math.atan(Math.exp(mercatorY / 6_378_137)) - Math.PI / 2) * 180 / Math.PI;
    coordLabel.textContent = `${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (!dragging) return;
    dragging = false;
    if (Math.hypot(event.clientX - pointerStartX, event.clientY - pointerStartY) > 5) return;
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const projected = features.filter((feature) => active.has(feature.category)).map((feature) => { const p = project(feature.x, feature.y); return { feature, screenX: p.x, screenY: p.y }; });
    const picked = hitTestFoodFeature(x, y, projected, 7);
    if (!picked) { selected.innerHTML = '<strong>場所を選ぶ</strong><span>色の点を押すと、元のOSMタグを表示します。</span>'; return; }
    const tagLines = Object.entries(picked.feature.tags).map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    selected.innerHTML = `<strong>${escapeHtml(picked.feature.tags.name ?? '名称タグなし')}</strong><span>${labels[picked.feature.category]}の表示グループ · <a href="https://www.openstreetmap.org/${picked.feature.id}" target="_blank" rel="noreferrer">${escapeHtml(picked.feature.id)}</a></span><dl>${tagLines || '<div><dt>タグ</dt><dd>表示対象の元タグはありません</dd></div>'}</dl>`;
  };
  const onKeyDown = (event: KeyboardEvent) => {
    const step = 80 / view.scale;
    if (event.key === 'ArrowLeft') view.x -= step;
    else if (event.key === 'ArrowRight') view.x += step;
    else if (event.key === 'ArrowUp') view.y += step;
    else if (event.key === 'ArrowDown') view.y -= step;
    else if (event.key === '+' || event.key === '=') { event.preventDefault(); setZoom(1.25); return; }
    else if (event.key === '-') { event.preventDefault(); setZoom(0.8); return; }
    else return;
    event.preventDefault(); schedule();
  };
  const onResize = () => fit();
  const ro = new ResizeObserver(onResize); ro.observe(canvas);
  canvas.addEventListener('wheel', onWheel, { passive: false }); canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove); canvas.addEventListener('pointerup', onPointerUp); canvas.addEventListener('keydown', onKeyDown);
  fit();
  const firstFrameMs = performance.now() - started;
  return {
    get zoomLevel() { return zoomLevel; },
    setZoom,
    resetView() { view.x = initial.x; view.y = initial.y; zoomLevel = 1; fit(); },
    setCategory(category, enabled) { if (enabled) active.add(category); else active.delete(category); fit(); },
    featureCount: features.length,
    pointCount: features.filter((feature) => feature.source === 'point').length,
    areaCount: features.filter((feature) => feature.source === 'polygon').length,
    gridCellCount: cells.length,
    cuisineTaggedCount: features.filter((feature) => feature.tags.cuisine !== undefined).length,
    cuisineUnspecifiedCount: features.filter((feature) => feature.tags.cuisine === undefined).length,
    get visibleCount() { let count = 0; for (const category of allCategories) if (active.has(category)) count += groupedFeatures[category].length; return count; },
    firstFrameMs,
    canvas,
    inspectionFeatureId,
    draw,
    screenPoint(featureId) { const feature = features.find((candidate) => candidate.id === featureId); return feature ? project(feature.x, feature.y) : null; },
    dispose() { disposed = true; ro.disconnect(); if (raf) cancelAnimationFrame(raf); canvas.removeEventListener('wheel', onWheel); canvas.removeEventListener('pointerdown', onPointerDown); canvas.removeEventListener('pointermove', onPointerMove); canvas.removeEventListener('pointerup', onPointerUp); canvas.removeEventListener('keydown', onKeyDown); },
  };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
