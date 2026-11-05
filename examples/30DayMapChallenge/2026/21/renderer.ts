import { buildSpatialIndex, decodeOsmFeatures, hitTest, querySpatialIndex, type Category, type Extent, type OSMFeature, type XY } from './osm.ts';

const EXTENT: Extent = { xmin: 15_549_663.07145842, ymin: 4_252_568.169330002, xmax: 15_553_002.656182218, ymax: 4_255_993.530861105 };
const CATEGORIES: Category[] = ['green', 'water', 'building', 'road', 'railway', 'public-place'];
const CSS_COLORS: Record<Category, string> = {
  green: '#759b6f', water: '#53a0b9', building: '#f0e4d3', road: '#9c6b49', railway: '#9e4760', 'public-place': '#ba4e33',
};
const ORDER: Record<Category, number> = { green: 0, water: 1, building: 2, road: 3, railway: 4, 'public-place': 5 };
const LABEL: Record<Category, string> = { green: '緑地', water: '水域', building: '建物', road: '道路', railway: '鉄道', 'public-place': '公共・生活施設' };

interface Camera { scale: number; centerX: number; centerY: number }
interface DrawFeature { feature: OSMFeature; xmin: number; ymin: number; xmax: number; ymax: number }
export interface OSMRenderer {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  features: OSMFeature[];
  visible: Record<Category, boolean>;
  firstFrameMs: number;
  camera: Camera;
  draw(): void;
  setCategory(category: Category, enabled: boolean): void;
  resetView(): void;
  zoomBy(factor: number, anchor?: XY): void;
  select(feature: OSMFeature | null): void;
  selectNext(direction: number): void;
  mapAtScreen(point: XY): XY;
  screenAtMap(point: XY): XY;
  featureScreenPoint(feature: OSMFeature): XY;
  setCoordinateAt(point: XY): void;
}

function mercatorToLonLat([x, y]: XY): [number, number] {
  return [x / 6378137 * 180 / Math.PI, (2 * Math.atan(Math.exp(y / 6378137)) - Math.PI / 2) * 180 / Math.PI];
}
function niceDistance(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 1;
  const exponent = Math.floor(Math.log10(target));
  const base = 10 ** exponent, fraction = target / base;
  return (fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1) * base;
}
function osmFeatureUrl(feature: OSMFeature): string {
  const id = feature.id < 0n ? -feature.id : feature.id;
  const type = feature.id < 0n ? 'relation' : feature.table === 'planet_osm_point' ? 'node' : 'way';
  return `https://www.openstreetmap.org/${type}/${id}`;
}

export async function mount(canvas: HTMLCanvasElement, dataUrl: string): Promise<OSMRenderer> {
  const started = performance.now();
  const response = await fetch(`${dataUrl}/osm.bin`);
  if (!response.ok) throw new Error(`OSM feature data ${response.status}`);
  const features = decodeOsmFeatures(new Uint8Array(await response.arrayBuffer()));
  const orderedFeatures: DrawFeature[] = features.map((feature) => {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const part of feature.geometry.parts) for (const [x, y] of part) {
      xmin = Math.min(xmin, x); ymin = Math.min(ymin, y); xmax = Math.max(xmax, x); ymax = Math.max(ymax, y);
    }
    return { feature, xmin, ymin, xmax, ymax };
  }).sort((a, b) => ORDER[a.feature.category] - ORDER[b.feature.category]);
  const spatialIndex = buildSpatialIndex(orderedFeatures.map(({ xmin, ymin, xmax, ymax }) => ({ xmin, ymin, xmax, ymax })));
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  let ctx: CanvasRenderingContext2D = context;
  const visible: Record<Category, boolean> = Object.fromEntries(CATEGORIES.map((category) => [category, true])) as Record<Category, boolean>;
  const camera: Camera = { scale: 1, centerX: (EXTENT.xmin + EXTENT.xmax) / 2, centerY: (EXTENT.ymin + EXTENT.ymax) / 2 };
  let width = 1, height = 1, dpr = 1, fitScale = 1, previousFitScale = 1, hasSized = false, selected: OSMFeature | null = null, isDragging = false, lastX = 0, lastY = 0;
  const mainContext = ctx;
  let project = (position: XY): XY => [width / 2 + (position[0] - camera.centerX) * camera.scale, height / 2 - (position[1] - camera.centerY) * camera.scale];
  let cacheCamera: Camera = { ...camera }, cacheWidth = 0, cacheHeight = 0, cacheDirty = true;
  let layerCanvases: Partial<Record<Category, HTMLCanvasElement>> = {};
  let framePending = false;
  const info = document.getElementById('feature-info')!;
  const readout = document.getElementById('coordinate')!;
  const scaleCanvas = document.getElementById('scale-bar') as HTMLCanvasElement;
  const map = {} as OSMRenderer;
  Object.assign(map, { canvas, context: ctx, features, visible, camera, firstFrameMs: 0 });

  const mainProject = (position: XY): XY => [width / 2 + (position[0] - camera.centerX) * camera.scale, height / 2 - (position[1] - camera.centerY) * camera.scale];
  const requestDraw = () => { if (!framePending) { framePending = true; requestAnimationFrame(() => { framePending = false; map.draw(); }); } };
  function linePath(points: XY[]) {
    if (!points.length) return;
    const first = project(points[0]!); ctx.beginPath(); ctx.moveTo(first[0], first[1]);
    for (let i = 1; i < points.length; i++) { const point = project(points[i]!); ctx.lineTo(point[0], point[1]); }
  }
  function drawPolygon(feature: OSMFeature) {
    const ends = feature.geometry.polygonRingEnds ?? [feature.geometry.parts.length];
    let start = 0;
    for (const end of ends) {
      ctx.beginPath();
      for (let ringIndex = start; ringIndex < end; ringIndex++) {
        const ring = feature.geometry.parts[ringIndex]!;
        if (!ring.length) continue;
        const first = project(ring[0]!); ctx.moveTo(first[0], first[1]);
        for (let i = 1; i < ring.length; i++) { const point = project(ring[i]!); ctx.lineTo(point[0], point[1]); }
        ctx.closePath();
      }
      if (feature.category === 'building') {
        ctx.fillStyle = CSS_COLORS.building; ctx.fill('evenodd');
        if (camera.scale > 0.12) { ctx.lineWidth = Math.min(0.7, 0.18 + camera.scale * 0.25); ctx.strokeStyle = '#b69e83'; ctx.stroke(); }
      } else if (feature.category === 'green') {
        ctx.fillStyle = CSS_COLORS.green; ctx.fill('evenodd');
      } else if (feature.category === 'water') {
        ctx.fillStyle = CSS_COLORS.water; ctx.fill('evenodd');
      }
      start = end;
    }
  }
  function drawFeature(feature: OSMFeature) {
    if (feature.geometry.type === 'polygon') { drawPolygon(feature); return; }
    if (feature.geometry.type === 'point') {
      for (const part of feature.geometry.parts) {
        if (!part[0]) continue;
        const [x, y] = project(part[0]);
        const radius = camera.scale < 0.3 ? 0.95 : Math.min(3.4, 1.6 + camera.scale * 1.2);
        ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fillStyle = CSS_COLORS['public-place']; ctx.fill();
        ctx.strokeStyle = '#fff7e8'; ctx.lineWidth = 0.7; ctx.stroke();
      }
      return;
    }
    for (const line of feature.geometry.parts) {
      if (line.length < 2) continue;
      linePath(line);
      if (feature.category === 'water') { ctx.strokeStyle = CSS_COLORS.water; ctx.lineWidth = 1.5; }
      else if (feature.category === 'railway') { ctx.strokeStyle = CSS_COLORS.railway; ctx.lineWidth = 1.65; ctx.setLineDash([4, 2]); }
      else {
        const highway = feature.tags.highway;
        ctx.strokeStyle = CSS_COLORS.road;
        ctx.lineWidth = highway === 'motorway' || highway === 'trunk' ? 2.8
          : highway === 'primary' ? 2.2 : highway === 'secondary' ? 1.7
            : highway === 'tertiary' ? 1.25 : highway === 'residential' || highway === 'unclassified' ? 0.9 : 0.65;
      }
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); ctx.setLineDash([]);
    }
  }
  function updateScaleBar() {
    const ratio = scaleCanvas.width / Math.max(1, scaleCanvas.clientWidth);
    const ctx = scaleCanvas.getContext('2d'); if (!ctx) return;
    const projected = niceDistance(150 / camera.scale); const pixels = projected * camera.scale;
    ctx.clearRect(0, 0, scaleCanvas.width, scaleCanvas.height); ctx.scale(ratio, ratio);
    ctx.strokeStyle = '#293c38'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(5, 18); ctx.lineTo(5 + pixels, 18); ctx.moveTo(5, 14); ctx.lineTo(5, 22); ctx.moveTo(5 + pixels, 14); ctx.lineTo(5 + pixels, 22); ctx.stroke();
    ctx.fillStyle = '#293c38'; ctx.font = '11px system-ui'; ctx.fillText(`EPSG:3857 ${projected >= 1000 ? `${(projected / 1000).toFixed(projected >= 10_000 ? 0 : 1)} km` : `${Math.round(projected)} m`} projected`, 5, 11);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  function buildLayerCache() {
    cacheCamera = { ...camera }; cacheWidth = Math.ceil(width * 1.5); cacheHeight = Math.ceil(height * 1.5);
    layerCanvases = {};
    const cacheBounds = {
      xmin: cacheCamera.centerX - cacheWidth / (2 * cacheCamera.scale),
      xmax: cacheCamera.centerX + cacheWidth / (2 * cacheCamera.scale),
      ymin: cacheCamera.centerY - cacheHeight / (2 * cacheCamera.scale),
      ymax: cacheCamera.centerY + cacheHeight / (2 * cacheCamera.scale),
    };
    const candidates = querySpatialIndex(spatialIndex, cacheBounds);
    for (const category of CATEGORIES) {
      const layer = document.createElement('canvas');
      layer.width = Math.max(1, Math.round(cacheWidth * dpr)); layer.height = Math.max(1, Math.round(cacheHeight * dpr));
      const layerContext = layer.getContext('2d');
      if (!layerContext) throw new Error('Canvas 2D layer cache is unavailable');
      ctx = layerContext; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      project = ([x, y]) => [cacheWidth / 2 + (x - cacheCamera.centerX) * cacheCamera.scale, cacheHeight / 2 - (y - cacheCamera.centerY) * cacheCamera.scale];
      for (const featureIndex of candidates) {
        const item = orderedFeatures[featureIndex]!;
        if (item.feature.category === category) drawFeature(item.feature);
      }
      layerCanvases[category] = layer;
    }
    ctx = mainContext; project = mainProject; cacheDirty = false;
  }
  function ensureLayerCache() {
    if (!cacheDirty) {
      const ratio = camera.scale / cacheCamera.scale;
      const displacementX = Math.abs(camera.centerX - cacheCamera.centerX) + width / (2 * camera.scale);
      const displacementY = Math.abs(camera.centerY - cacheCamera.centerY) + height / (2 * camera.scale);
      if (ratio < 0.5 || ratio > 2 || displacementX > cacheWidth / (2 * cacheCamera.scale) || displacementY > cacheHeight / (2 * cacheCamera.scale)) cacheDirty = true;
    }
    if (cacheDirty) buildLayerCache();
  }
  function candidatesAt(point: XY, tolerance: number): OSMFeature[] {
    const extent = { xmin: point[0] - tolerance, xmax: point[0] + tolerance, ymin: point[1] - tolerance, ymax: point[1] + tolerance };
    return querySpatialIndex(spatialIndex, extent).map((index) => orderedFeatures[index]!.feature).filter((feature) => visible[feature.category]);
  }
  function setSize() {
    dpr = Math.min(2, window.devicePixelRatio || 1); width = canvas.clientWidth; height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr)); canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fitScale = Math.min((width - 70) / (EXTENT.xmax - EXTENT.xmin), (height - 90) / (EXTENT.ymax - EXTENT.ymin));
    camera.scale = hasSized ? camera.scale * fitScale / previousFitScale : fitScale;
    previousFitScale = fitScale; hasSized = true;
    cacheDirty = true;
    requestDraw();
  }
  function writeSelection(feature: OSMFeature | null) {
    selected = feature;
    if (!feature) { info.innerHTML = '<p class="empty">地図上を選択するか、施設をキーボードで巡回できます。</p>'; return; }
    const link = document.createElement('a'); link.href = osmFeatureUrl(feature); link.target = '_blank'; link.rel = 'noreferrer'; link.textContent = `${feature.id < 0n ? 'relation' : feature.table === 'planet_osm_point' ? 'node' : 'way'}/${feature.id < 0n ? -feature.id : feature.id}`;
    const title = document.createElement('strong'); title.textContent = feature.tags.name ?? LABEL[feature.category];
    const identity = document.createElement('div'); identity.append('元データ: ', feature.table, ' · OSM ID: ', link);
    const tagList = document.createElement('dl');
    for (const [key, value] of Object.entries(feature.tags).sort(([a], [b]) => a.localeCompare(b))) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = key; dd.textContent = value; tagList.append(dt, dd);
    }
    info.replaceChildren(title, identity, tagList);
  }
  function pixelsPerGroundMeter(): number { return camera.scale * Math.cos(mercatorToLonLat([camera.centerX, camera.centerY])[1] * Math.PI / 180); }
  map.draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = '#f3f0e7'; ctx.fillRect(0, 0, width, height);
    ensureLayerCache();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, width, height); ctx.clip();
    const ratio = camera.scale / cacheCamera.scale;
    const offsetX = width / 2 + (cacheCamera.centerX - camera.centerX) * camera.scale - cacheWidth * ratio / 2;
    const offsetY = height / 2 + (camera.centerY - cacheCamera.centerY) * camera.scale - cacheHeight * ratio / 2;
    for (const category of CATEGORIES) {
      const layer = layerCanvases[category];
      if (visible[category] && layer) ctx.drawImage(layer, offsetX, offsetY, cacheWidth * ratio, cacheHeight * ratio);
    }
    if (selected && visible[selected.category]) {
      ctx.save(); ctx.globalAlpha = 0.92; ctx.strokeStyle = '#263a35'; ctx.lineWidth = 2.4; ctx.setLineDash([]);
      if (selected.geometry.type === 'point') {
        for (const part of selected.geometry.parts) if (part[0]) { const point = project(part[0]); ctx.beginPath(); ctx.arc(point[0], point[1], 8, 0, Math.PI * 2); ctx.stroke(); }
      } else if (selected.geometry.type === 'line') {
        for (const part of selected.geometry.parts) { linePath(part); ctx.stroke(); }
      } else {
        for (const part of selected.geometry.parts) { linePath(part); ctx.closePath(); ctx.stroke(); }
      }
      ctx.restore();
    }
    ctx.restore();
    updateScaleBar();
    if (!map.firstFrameMs) map.firstFrameMs = performance.now() - started;
  };
  map.setCategory = (category, enabled) => { visible[category] = enabled; requestDraw(); };
  map.resetView = () => { camera.centerX = (EXTENT.xmin + EXTENT.xmax) / 2; camera.centerY = (EXTENT.ymin + EXTENT.ymax) / 2; camera.scale = fitScale; requestDraw(); };
  map.zoomBy = (factor, anchor = [width / 2, height / 2]) => {
    const before = map.mapAtScreen(anchor); camera.scale = Math.min(8, Math.max(0.015, camera.scale * factor));
    camera.centerX = before[0] - (anchor[0] - width / 2) / camera.scale;
    camera.centerY = before[1] + (anchor[1] - height / 2) / camera.scale; requestDraw();
  };
  map.select = writeSelection;
  map.selectNext = (direction) => {
    const pickable = features.filter((feature) => feature.category === 'public-place' && visible[feature.category]);
    if (!pickable.length) return;
    const current = selected ? pickable.indexOf(selected) : -1;
    const next = current < 0 ? (direction > 0 ? 0 : pickable.length - 1) : (current + direction + pickable.length) % pickable.length;
    writeSelection(pickable[next]!); requestDraw();
  };
  map.mapAtScreen = ([x, y]) => [camera.centerX + (x - width / 2) / camera.scale, camera.centerY - (y - height / 2) / camera.scale];
  map.screenAtMap = project;
  map.featureScreenPoint = (feature) => {
    const all = feature.geometry.parts.flat();
    return project(all[Math.floor(all.length / 2)] ?? [camera.centerX, camera.centerY]);
  };
  map.setCoordinateAt = ([x, y]) => {
    const [lon, lat] = mercatorToLonLat(map.mapAtScreen([x, y]));
    readout.textContent = `${lat.toFixed(5)}° N, ${lon.toFixed(5)}° E · 地上縮尺 ≈ ${(pixelsPerGroundMeter() * 100).toFixed(2)} px/100m`;
  };
  canvas.addEventListener('pointerdown', (event) => { isDragging = true; lastX = event.clientX; lastY = event.clientY; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    const point: XY = [event.offsetX, event.offsetY]; map.setCoordinateAt(point);
    if (isDragging) { camera.centerX -= (event.clientX - lastX) / camera.scale; camera.centerY += (event.clientY - lastY) / camera.scale; lastX = event.clientX; lastY = event.clientY; requestDraw(); }
  });
  canvas.addEventListener('pointerup', (event) => { isDragging = false; canvas.releasePointerCapture(event.pointerId); });
  canvas.addEventListener('pointercancel', () => { isDragging = false; });
  canvas.addEventListener('click', (event) => {
    const point = map.mapAtScreen([event.offsetX, event.offsetY]);
    const tolerance = 11 / camera.scale;
    writeSelection(hitTest(candidatesAt(point, tolerance), point, tolerance));
    requestDraw();
  });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); map.zoomBy(event.deltaY < 0 ? 1.2 : 1 / 1.2, [event.offsetX, event.offsetY]); }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const step = 70 / camera.scale;
    if (event.key === 'ArrowLeft') camera.centerX -= step;
    else if (event.key === 'ArrowRight') camera.centerX += step;
    else if (event.key === 'ArrowUp') camera.centerY += step;
    else if (event.key === 'ArrowDown') camera.centerY -= step;
    else if (event.key === '+' || event.key === '=') map.zoomBy(1.25);
    else if (event.key === '-') map.zoomBy(0.8);
    else if (event.key === '[') map.selectNext(-1);
    else if (event.key === ']') map.selectNext(1);
    else if (event.key === 'Enter') {
      const point = map.mapAtScreen([width / 2, height / 2]), tolerance = 18 / camera.scale;
      writeSelection(hitTest(candidatesAt(point, tolerance), point, tolerance));
    }
    else return;
    event.preventDefault(); requestDraw();
  });
  new ResizeObserver(setSize).observe(canvas);
  setSize(); map.draw();
  return map;
}
