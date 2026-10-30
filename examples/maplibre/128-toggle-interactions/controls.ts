export type ToggleName = 'dragPan' | 'scrollZoom' | 'dblClickZoom';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ToggleMap {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  center: [number, number];
  zoom: number;
  toggles: Record<ToggleName, boolean>;
  draw(): void;
  panBy(dx: number, dy: number): void;
  setZoom(z: number): void;
  zoomAtPoint(x: number, y: number, z: number): void;
  getScreenPos(lon: number, lat: number): [number, number];
  getPanelRect(): Rect;
  getRowRect(i: number): Rect;
  getCheckboxRect(i: number): Rect;
  rows: { name: ToggleName; label: string }[];
  resetView(): void;
  destroy(): void;
}

type Ring = [number, number][];
type Polygon = Ring[];

const CENTER_LNG = -77.04;
const CENTER_LAT = 38.907;
const DEFAULT_ZOOM = 3;

const PANEL_X = 12;
const PANEL_Y = 12;
const PANEL_W = 196;
const PAD = 8;
const HEADER_H = 24;
const ROW_H = 26;
const BOX = 14;

const ACCENT = '#2a7ae2';
const OCEAN = '#aad3df';
const LAND = '#f0eee8';
const LAND_EDGE = '#d0cdc4';

const mercY = (lat: number): number =>
  (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const mercX = (lon: number): number => (lon + 180) / 360;

const defaultCenterMx = mercX(CENTER_LNG);
const defaultCenterMy = mercY(CENTER_LAT);

export async function mount(canvas: HTMLCanvasElement, landUrl: string): Promise<ToggleMap> {
  const rawCtx = canvas.getContext('2d', { willReadFrequently: true });
  if (!rawCtx) throw new Error('2D context not available');
  const ctx: CanvasRenderingContext2D = rawCtx;

  const res = await fetch(landUrl);
  if (!res.ok) throw new Error(`failed to fetch land polygons: ${res.status}`);
  const polygons = (await res.json()) as Polygon[];

  const rows: { name: ToggleName; label: string }[] = [
    { name: 'dragPan', label: 'Drag pan' },
    { name: 'scrollZoom', label: 'Scroll zoom' },
    { name: 'dblClickZoom', label: 'Double-click zoom' },
  ];
  const toggles: Record<ToggleName, boolean> = {
    dragPan: true,
    scrollZoom: true,
    dblClickZoom: true,
  };

  let centerMx = defaultCenterMx;
  let centerMy = defaultCenterMy;
  let zoom = DEFAULT_ZOOM;
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

  function getScreenPos(lon: number, lat: number): [number, number] {
    const scale = 256 * Math.pow(2, zoom);
    return [
      width / 2 + (mercX(lon) - centerMx) * scale,
      height / 2 + (mercY(lat) - centerMy) * scale,
    ];
  }

  function getPanelRect(): Rect {
    return {
      x: PANEL_X,
      y: PANEL_Y,
      width: PANEL_W,
      height: PAD + HEADER_H + rows.length * ROW_H + PAD,
    };
  }

  function getRowRect(i: number): Rect {
    const p = getPanelRect();
    return { x: p.x, y: p.y + PAD + HEADER_H + i * ROW_H, width: p.width, height: ROW_H };
  }

  function getCheckboxRect(i: number): Rect {
    const r = getRowRect(i);
    return { x: r.x + 10, y: r.y + (ROW_H - BOX) / 2, width: BOX, height: BOX };
  }

  function drawPanel(): void {
    const p = getPanelRect();
    const r = 6;
    ctx.beginPath();
    ctx.moveTo(p.x + r, p.y);
    ctx.lineTo(p.x + p.width - r, p.y);
    ctx.arcTo(p.x + p.width, p.y, p.x + p.width, p.y + r, r);
    ctx.lineTo(p.x + p.width, p.y + p.height - r);
    ctx.arcTo(p.x + p.width, p.y + p.height, p.x + p.width - r, p.y + p.height, r);
    ctx.lineTo(p.x + r, p.y + p.height);
    ctx.arcTo(p.x, p.y + p.height, p.x, p.y + p.height - r, r);
    ctx.lineTo(p.x, p.y + r);
    ctx.arcTo(p.x, p.y + r, p.x + r, p.y, r);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.fill();

    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.fillStyle = '#1f3a52';
    ctx.fillText('Interactions', p.x + 10, p.y + PAD + HEADER_H / 2);

    ctx.font = '12px system-ui, sans-serif';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const b = getCheckboxRect(i);
      ctx.fillStyle = toggles[row.name] ? ACCENT : '#ffffff';
      ctx.fillRect(b.x, b.y, b.width, b.height);
      ctx.strokeStyle = toggles[row.name] ? ACCENT : '#8a8a8a';
      ctx.lineWidth = 1;
      ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.width - 1, b.height - 1);
      if (toggles[row.name]) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(b.x + 3, b.y + 7);
        ctx.lineTo(b.x + 6, b.y + 10);
        ctx.lineTo(b.x + 11, b.y + 4);
        ctx.stroke();
      }
      ctx.fillStyle = '#333333';
      ctx.fillText(row.label, b.x + BOX + 10, b.y + BOX / 2 + 0.5);
    }
  }

  function draw(): void {
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = OCEAN;
    ctx.fillRect(0, 0, width, height);

    const scale = 256 * Math.pow(2, zoom);
    const originX = width / 2 - centerMx * scale;
    const originY = height / 2 - centerMy * scale;

    ctx.fillStyle = LAND;
    ctx.strokeStyle = LAND_EDGE;
    ctx.lineWidth = 1;
    const minWrap = Math.floor(centerMx - width / (2 * scale));
    const maxWrap = Math.floor(centerMx + width / (2 * scale));
    for (let wrap = minWrap; wrap <= maxWrap; wrap++) {
      const shiftX = originX + wrap * scale;
      for (const poly of polygons) {
        if (poly.length === 0) continue;
        ctx.beginPath();
        for (const ring of poly) {
          for (let i = 0; i < ring.length; i++) {
            const x = shiftX + ring[i][0] * scale;
            const y = originY + ring[i][1] * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.fill();
        ctx.stroke();
      }
    }

    drawPanel();
    ctx.restore();
  }

  function rowAt(x: number, y: number): number {
    const p = getPanelRect();
    if (x < p.x || y < p.y || x > p.x + p.width || y > p.y + p.height) return -1;
    for (let i = 0; i < rows.length; i++) {
      const r = getRowRect(i);
      if (y >= r.y && y < r.y + r.height) return i;
    }
    return -1;
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  function onPointerDown(e: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const row = rowAt(x, y);
    if (row >= 0) {
      const name = rows[row].name;
      toggles[name] = !toggles[name];
      draw();
      return;
    }
    if (!toggles.dragPan) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch {}
  }

  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    panBy(dx, dy);
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragging) {
      dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!toggles.scrollZoom) return;
    const rect = canvas.getBoundingClientRect();
    const step = e.deltaY < 0 ? 0.5 : -0.5;
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + step);
  }

  function onDblClick(e: MouseEvent): void {
    if (!toggles.dblClickZoom) return;
    const rect = canvas.getBoundingClientRect();
    zoomAtPoint(e.clientX - rect.left, e.clientY - rect.top, zoom + 1);
  }

  function zoomAtPoint(x: number, y: number, z: number): void {
    const before = 256 * Math.pow(2, zoom);
    const ox = x - width / 2;
    const oy = y - height / 2;
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
    zoom = Math.max(1, Math.min(10, z));
    draw();
  }

  function resetView(): void {
    centerMx = defaultCenterMx;
    centerMy = defaultCenterMy;
    zoom = DEFAULT_ZOOM;
    for (const row of rows) toggles[row.name] = true;
    draw();
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('dblclick', onDblClick);

  const ro = new ResizeObserver(() => resize());
  ro.observe(canvas);
  resize();

  return {
    canvas,
    ctx,
    get center(): [number, number] { return [centerMx, centerMy]; },
    get zoom() { return zoom; },
    toggles,
    draw,
    panBy,
    setZoom,
    zoomAtPoint,
    getScreenPos,
    getPanelRect,
    getRowRect,
    getCheckboxRect,
    rows,
    resetView,
    destroy() {
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('dblclick', onDblClick);
    },
  };
}
