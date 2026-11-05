import { calibrationPxPerMm, decodeTerritory, groundScale, screenPoint, zoomAt, type BuildingFeature, type TerritoryBounds, type TerritoryView } from './territory.ts';

interface Stats {
  source: string;
  sourceBuildingRows: number; uniqueOsmIds: number; ringCount: number; vertexCount: number; outputBytes: number;
  queryBoundsEpsg3857: TerritoryBounds; centerWgs84: { lon: number; lat: number };
  physicalFocus: { osmRelationId: number; epsg3857: { x: number; y: number }; wgs84: { lon: number; lat: number } };
}
const COLORS: Record<string, string> = {
  yes: '#af7455', residential: '#d39867', commercial: '#c67d59', retail: '#dc9c68',
  industrial: '#9d806b', office: '#bb795d', civic: '#be9c72',
};

export type TerritoryMap = Awaited<ReturnType<typeof mount>>;

export async function mount(canvas: HTMLCanvasElement, overviewCanvas: HTMLCanvasElement, base: string) {
  const started = performance.now();
  const [binaryResponse, statsResponse] = await Promise.all([fetch(`${base}/buildings.bin`), fetch(`${base}/stats.json`)]);
  if (!binaryResponse.ok) throw new Error(`buildings.bin: HTTP ${binaryResponse.status}`);
  if (!statsResponse.ok) throw new Error(`stats.json: HTTP ${statsResponse.status}`);
  const [buffer, stats] = await Promise.all([binaryResponse.arrayBuffer(), statsResponse.json() as Promise<Stats>]);
  const dataset = decodeTerritory(buffer);
  if (dataset.features.length !== stats.sourceBuildingRows || stats.sourceBuildingRows !== stats.uniqueOsmIds) throw new Error('OSM building count mismatch');
  const context = canvas.getContext('2d', { alpha: false });
  const overview = overviewCanvas.getContext('2d', { alpha: false });
  if (!context || !overview) throw new Error('Canvas 2D is unavailable');
  const bounds = dataset.bounds;
  const centerX = (bounds.xmin + bounds.xmax) / 2, centerY = (bounds.ymin + bounds.ymax) / 2;
  const lat = stats.physicalFocus.wgs84.lat;
  const view: TerritoryView = { centerX, centerY, pixelsPerProjectedMeter: 1, zoom: 1 };
  const state = { calibrated: false, physicalMode: false, cardReferenceCssPixels: 320, selected: -1, pointer: null as [number, number] | null };
  let width = 0, height = 0, overviewWidth = 0, overviewHeight = 0, dpr = 1;
  let drag: [number, number] | null = null;
  let baseFitScale = 1;
  let firstFrameMs = 0;
  let frames = 0;
  let pointerMoved = false;
  const featureBounds = dataset.features.map((feature) => {
    let xmin = Infinity, ymin = Infinity, xmax = -Infinity, ymax = -Infinity;
    for (const ring of feature.rings) for (let i = 0; i < ring.length; i += 2) {
      xmin = Math.min(xmin, ring[i]!); ymin = Math.min(ymin, ring[i + 1]!);
      xmax = Math.max(xmax, ring[i]!); ymax = Math.max(ymax, ring[i + 1]!);
    }
    return { xmin, ymin, xmax, ymax };
  });
  const paths: Path2D[] = dataset.features.map((feature) => {
    const path = new Path2D();
    for (const ring of feature.rings) {
      if (ring.length < 6) continue;
      path.moveTo(ring[0]!, ring[1]!);
      for (let i = 2; i < ring.length; i += 2) path.lineTo(ring[i]!, ring[i + 1]!);
      path.closePath();
    }
    return path;
  });

  function screen(x: number, y: number): [number, number] { return screenPoint(x, y, view, width, height); }

  function drawOverview() {
    if (!overviewWidth || !overviewHeight) return;
    const scale = Math.min((overviewWidth - 20) / (bounds.xmax - bounds.xmin), (overviewHeight - 20) / (bounds.ymax - bounds.ymin));
    overview!.setTransform(dpr, 0, 0, dpr, 0, 0);
    overview!.fillStyle = '#d1c9b7'; overview!.fillRect(0, 0, overviewWidth, overviewHeight);
    const ox = (overviewWidth - (bounds.xmax - bounds.xmin) * scale) / 2;
    const oy = (overviewHeight - (bounds.ymax - bounds.ymin) * scale) / 2;
    overview!.save();
    overview!.beginPath(); overview!.rect(ox, oy, (bounds.xmax - bounds.xmin) * scale, (bounds.ymax - bounds.ymin) * scale); overview!.clip();
    overview!.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * (ox - bounds.xmin * scale), dpr * (oy + bounds.ymax * scale));
    for (let i = 0; i < dataset.features.length; i++) {
      const feature = dataset.features[i]!;
      overview!.fillStyle = COLORS[feature.kind] ?? COLORS.yes!;
      overview!.fill(paths[i]!, 'evenodd');
      overview!.strokeStyle = 'rgba(65,43,32,.65)'; overview!.lineWidth = Math.max(0.14, 0.45 / scale);
      overview!.stroke(paths[i]!);
    }
    overview!.restore();
    const viewScale = view.pixelsPerProjectedMeter * view.zoom;
    const viewXmin = view.centerX - width / (2 * viewScale), viewXmax = view.centerX + width / (2 * viewScale);
    const viewYmin = view.centerY - height / (2 * viewScale), viewYmax = view.centerY + height / (2 * viewScale);
    const rectX = ox + (viewXmin - bounds.xmin) * scale, rectY = oy + (bounds.ymax - viewYmax) * scale;
    const rectW = (viewXmax - viewXmin) * scale, rectH = (viewYmax - viewYmin) * scale;
    overview!.strokeStyle = '#fff4d8'; overview!.lineWidth = 1;
    overview!.strokeRect(rectX - (rectW < 3 ? (3 - rectW) / 2 : 0), rectY - (rectH < 3 ? (3 - rectH) / 2 : 0), Math.max(3, rectW), Math.max(3, rectH));
    overview!.fillStyle = '#172630'; overview!.font = '10px system-ui'; overview!.fillText('500 m · EPSG:3857', 7, overviewHeight - 6);
  }

  function draw() {
    if (!width || !height) return;
    const scale = view.pixelsPerProjectedMeter * view.zoom;
    context!.setTransform(dpr, 0, 0, dpr, 0, 0);
    context!.fillStyle = '#d1c9b7'; context!.fillRect(0, 0, width, height);
    context!.save(); context!.beginPath(); context!.rect(0, 0, width, height); context!.clip();
    context!.setTransform(dpr * scale, 0, 0, -dpr * scale, dpr * (width / 2 - view.centerX * scale), dpr * (height / 2 + view.centerY * scale));
    context!.beginPath(); context!.rect(bounds.xmin, bounds.ymin, bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin); context!.clip();
    const lineWidth = Math.max(0.06, 0.45 / scale);
    for (let i = 0; i < dataset.features.length; i++) {
      const feature = dataset.features[i]!;
      context!.fillStyle = COLORS[feature.kind] ?? COLORS.yes!;
      context!.fill(paths[i]!, 'evenodd');
      context!.strokeStyle = i === state.selected ? '#fcf0cc' : 'rgba(58,39,29,.76)';
      context!.lineWidth = i === state.selected ? lineWidth * 2.6 : lineWidth;
      context!.stroke(paths[i]!);
    }
    if (state.pointer) {
      const [px, py] = state.pointer;
      context!.setTransform(dpr, 0, 0, dpr, 0, 0);
      context!.strokeStyle = 'rgba(28,42,47,.72)'; context!.lineWidth = 1;
      context!.beginPath(); context!.moveTo(px - 7, py); context!.lineTo(px + 7, py); context!.moveTo(px, py - 7); context!.lineTo(px, py + 7); context!.stroke();
    }
    context!.restore();
    drawOverview(); frames++;
    if (firstFrameMs === 0) firstFrameMs = performance.now() - started;
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth; height = canvas.clientHeight;
    overviewWidth = overviewCanvas.clientWidth; overviewHeight = overviewCanvas.clientHeight;
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    overviewCanvas.width = Math.round(overviewWidth * dpr); overviewCanvas.height = Math.round(overviewHeight * dpr);
    baseFitScale = Math.min((width - 40) / (bounds.xmax - bounds.xmin), (height - 40) / (bounds.ymax - bounds.ymin));
    if (!state.physicalMode) view.pixelsPerProjectedMeter = baseFitScale;
    draw();
  }

  function setPhysicalMode(enabled: boolean) {
    if (enabled && !state.calibrated) throw new Error('Calibrate the display before entering physical scale mode');
    state.physicalMode = enabled;
    view.pixelsPerProjectedMeter = enabled ? groundScale(calibrationPxPerMm(state.cardReferenceCssPixels), lat) : baseFitScale;
    view.zoom = 1;
    view.centerX = enabled ? stats.physicalFocus.epsg3857.x : centerX;
    view.centerY = enabled ? stats.physicalFocus.epsg3857.y : centerY;
    draw();
  }

  function setCalibration(referenceCssPixels: number) {
    state.cardReferenceCssPixels = referenceCssPixels;
    state.calibrated = true;
    if (state.physicalMode) view.pixelsPerProjectedMeter = groundScale(calibrationPxPerMm(referenceCssPixels), lat);
    draw();
  }

  function pointInRing(x: number, y: number, ring: Float64Array): boolean {
    let inside = false;
    for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
      const xi = ring[i]!, yi = ring[i + 1]!, xj = ring[j]!, yj = ring[j + 1]!;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function hitTest(x: number, y: number): number {
    const [worldX, worldY] = projectedAt(x, y);
    for (let i = dataset.features.length - 1; i >= 0; i--) {
      const box = featureBounds[i]!;
      if (worldX < box.xmin || worldX > box.xmax || worldY < box.ymin || worldY > box.ymax) continue;
      let inside = false;
      for (const ring of dataset.features[i]!.rings) if (pointInRing(worldX, worldY, ring)) inside = !inside;
      if (inside) return i;
    }
    return -1;
  }

  function projectedAt(x: number, y: number): [number, number] {
    const scale = view.pixelsPerProjectedMeter * view.zoom;
    return [view.centerX + (x - width / 2) / scale, view.centerY - (y - height / 2) / scale];
  }

  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect(); drag = [event.clientX - rect.left, event.clientY - rect.top]; pointerMoved = false; canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (event) => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    state.pointer = [x, y];
    if (drag) {
      const dx = x - drag[0], dy = y - drag[1], scale = view.pixelsPerProjectedMeter * view.zoom;
      if (Math.abs(dx) + Math.abs(dy) > 2) pointerMoved = true;
      view.centerX -= dx / scale; view.centerY += dy / scale; drag = [x, y];
    }
    draw();
  });
  canvas.addEventListener('pointerleave', () => { if (!drag) { state.pointer = null; draw(); } });
  canvas.addEventListener('pointerup', (event) => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    if (drag && !pointerMoved) {
      state.selected = hitTest(x, y);
      canvas.dispatchEvent(new CustomEvent('territoryselect', { detail: { index: state.selected, x, y } }));
    }
    drag = null; draw();
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const rect = canvas.getBoundingClientRect();
    Object.assign(view, zoomAt(view, view.zoom * Math.exp(-event.deltaY * 0.001), event.clientX - rect.left, event.clientY - rect.top, width, height)); draw();
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const stepX = width / (Math.max(1, view.pixelsPerProjectedMeter * view.zoom) * 20);
    const stepY = height / (Math.max(1, view.pixelsPerProjectedMeter * view.zoom) * 20);
    if (event.key === 'ArrowLeft') view.centerX -= stepX;
    else if (event.key === 'ArrowRight') view.centerX += stepX;
    else if (event.key === 'ArrowUp') view.centerY += stepY;
    else if (event.key === 'ArrowDown') view.centerY -= stepY;
    else if (event.key === '+' || event.key === '=') Object.assign(view, zoomAt(view, view.zoom * 1.25, width / 2, height / 2, width, height));
    else if (event.key === '-' || event.key === '_') Object.assign(view, zoomAt(view, view.zoom / 1.25, width / 2, height / 2, width, height));
    else if (event.key === 'Enter') {
      state.selected = hitTest(width / 2, height / 2);
      canvas.dispatchEvent(new CustomEvent('territoryselect', { detail: { index: state.selected, x: width / 2, y: height / 2 } }));
    } else return;
    event.preventDefault(); draw();
  });
  overviewCanvas.addEventListener('click', (event) => {
    const rect = overviewCanvas.getBoundingClientRect();
    const scale = Math.min((overviewWidth - 20) / (bounds.xmax - bounds.xmin), (overviewHeight - 20) / (bounds.ymax - bounds.ymin));
    const ox = (overviewWidth - (bounds.xmax - bounds.xmin) * scale) / 2, oy = (overviewHeight - (bounds.ymax - bounds.ymin) * scale) / 2;
    const x = (event.clientX - rect.left - ox) / scale + bounds.xmin;
    const y = bounds.ymax - (event.clientY - rect.top - oy) / scale;
    if (x >= bounds.xmin && x <= bounds.xmax && y >= bounds.ymin && y <= bounds.ymax) { view.centerX = x; view.centerY = y; draw(); }
  });
  overviewCanvas.addEventListener('keydown', (event) => {
    const step = (bounds.xmax - bounds.xmin) / 10;
    if (event.key === 'ArrowLeft') view.centerX -= step;
    else if (event.key === 'ArrowRight') view.centerX += step;
    else if (event.key === 'ArrowUp') view.centerY += step;
    else if (event.key === 'ArrowDown') view.centerY -= step;
    else if (event.key === 'Enter') { view.centerX = stats.physicalFocus.epsg3857.x; view.centerY = stats.physicalFocus.epsg3857.y; }
    else return;
    event.preventDefault(); draw();
  });
  new ResizeObserver(resize).observe(canvas); new ResizeObserver(resize).observe(overviewCanvas); resize();
  const initialFrameMs = performance.now() - started;

  return {
    dataset, stats, state, view, bounds, firstFrameMs: initialFrameMs,
    draw,
    setPhysicalMode,
    setCalibration,
    selectFeature(index: number) { state.selected = index >= 0 && index < dataset.features.length ? index : -1; draw(); },
    hitTest,
    screenPoint(x: number, y: number) { return screen(x, y); },
    projectedAt,
    get frameCount() { return frames; },
    get scalePxPerProjectedMeter() { return view.pixelsPerProjectedMeter * view.zoom; },
  };
}
