import { decodeSoundGrid, type SoundGrid } from './soundscape.ts';

export interface Bounds { west: number; east: number; south: number; north: number }
export interface SoundStats {
  sourceDate: string; sourceWays: number; roadWays: number; railWays: number; roadCells: number; railCells: number;
  gridWidth: number; gridHeight: number; bounds: Bounds; maxRoad: number; maxRail: number; outputBytes: number; model: string;
}
export interface SoundMap {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  grid: SoundGrid;
  stats: SoundStats;
  view: { zoom: number; panX: number; panY: number };
  selected: { x: number; y: number } | null;
  draw(): void;
  select(point: { x: number; y: number }): void;
  screenToGrid(x: number, y: number): { x: number; y: number } | null;
  gridToScreen(x: number, y: number): { x: number; y: number };
  firstFrameMs: number;
}

export function projectLocation(lon: number, lat: number, bounds: Bounds) {
  const mercatorY = (value: number) => Math.log(Math.tan(Math.PI / 4 + value * Math.PI / 360));
  const north = mercatorY(bounds.north), south = mercatorY(bounds.south);
  return { x: (lon - bounds.west) / (bounds.east - bounds.west), y: (north - mercatorY(lat)) / (north - south) };
}

export async function mount(canvas: HTMLCanvasElement, base: string): Promise<SoundMap> {
  const started = performance.now();
  const [gridResponse, statsResponse] = await Promise.all([fetch(`${base}/soundscape.bin`), fetch(`${base}/stats.json`)]);
  if (!gridResponse.ok || !statsResponse.ok) throw new Error(`Soundscape data unavailable (${gridResponse.status}, ${statsResponse.status})`);
  const [buffer, stats] = await Promise.all([gridResponse.arrayBuffer(), statsResponse.json() as Promise<SoundStats>]);
  const grid = decodeSoundGrid(buffer);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) throw new Error('Canvas 2D is unavailable');
  const field = document.createElement('canvas'); field.width = grid.width; field.height = grid.height;
  const fctx = field.getContext('2d')!;
  const image = fctx.createImageData(grid.width, grid.height);
  const roadScale = Math.log1p(stats.maxRoad), railScale = Math.log1p(stats.maxRail);
  for (let i = 0; i < grid.roads.length; i++) {
    const road = Math.log1p(grid.roads[i]!) / roadScale;
    const rail = Math.log1p(grid.rails[i]!) / railScale;
    const amount = Math.min(1, road + rail * 0.95);
    if (amount < 0.035) continue;
    const offset = i * 4;
    image.data[offset] = Math.round((road * 237 + rail * 44) / Math.max(road + rail, 0.001));
    image.data[offset + 1] = Math.round((road * 104 + rail * 205) / Math.max(road + rail, 0.001));
    image.data[offset + 2] = Math.round((road * 57 + rail * 226) / Math.max(road + rail, 0.001));
    image.data[offset + 3] = Math.round(Math.min(0.92, 0.1 + Math.sqrt(amount) * 0.82) * 255);
  }
  fctx.putImageData(image, 0, 0);
  const view = { zoom: 1, panX: 0, panY: 0 };
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const mapSize = () => Math.min(canvas.clientWidth, canvas.clientHeight) * 0.88 * view.zoom;
  const gridToScreen = (x: number, y: number) => {
    const size = mapSize();
    return { x: canvas.clientWidth / 2 + (x - 0.5) * size + view.panX, y: canvas.clientHeight / 2 + (y - 0.5) * size + view.panY };
  };
  const screenToGrid = (x: number, y: number) => {
    const size = mapSize();
    const gx = (x - canvas.clientWidth / 2 - view.panX) / size + 0.5;
    const gy = (y - canvas.clientHeight / 2 - view.panY) / size + 0.5;
    return gx < 0 || gx > 1 || gy < 0 || gy > 1 ? null : { x: gx, y: gy };
  };
  let selected: { x: number; y: number } | null = null;
  const map: SoundMap = {
    canvas, context, grid, stats, view, selected, firstFrameMs: 0,
    select(point) { selected = point; map.selected = point; map.draw(); canvas.dispatchEvent(new CustomEvent('soundscape-select', { detail: point })); },
    draw() {
      const width = Math.max(1, Math.round(canvas.clientWidth * dpr)), height = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.fillStyle = '#09151d'; context.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      const tl = gridToScreen(0, 0), size = mapSize();
      context.save(); context.imageSmoothingEnabled = true; context.globalAlpha = 0.92;
      context.drawImage(field, tl.x, tl.y, size, size); context.restore();
      context.save(); context.strokeStyle = '#93bdc322'; context.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        context.beginPath(); context.moveTo(tl.x + size * t, tl.y); context.lineTo(tl.x + size * t, tl.y + size); context.stroke();
        context.beginPath(); context.moveTo(tl.x, tl.y + size * t); context.lineTo(tl.x + size, tl.y + size * t); context.stroke();
      }
      context.strokeStyle = '#b8d2d344'; context.strokeRect(tl.x, tl.y, size, size); context.restore();
      if (selected) {
        const p = gridToScreen(selected.x, selected.y);
        context.beginPath(); context.arc(p.x, p.y, 8, 0, Math.PI * 2); context.fillStyle = '#fff3c8'; context.fill();
        context.beginPath(); context.arc(p.x, p.y, 13, 0, Math.PI * 2); context.strokeStyle = '#fff3c8aa'; context.lineWidth = 1.5; context.stroke();
      }
    },
    screenToGrid, gridToScreen,
  };
  Object.defineProperty(map, 'selected', { get: () => selected, set: (value) => { selected = value; } });
  canvas.addEventListener('pointerdown', (event) => {
    const rect = canvas.getBoundingClientRect();
    const point = screenToGrid(event.clientX - rect.left, event.clientY - rect.top);
    if (point) map.select(point);
  });
  let drag: { x: number; y: number; panX: number; panY: number } | null = null;
  canvas.addEventListener('pointerdown', (event) => { drag = { x: event.clientX, y: event.clientY, panX: view.panX, panY: view.panY }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || !(event.buttons & 1)) return;
    view.panX = drag.panX + event.clientX - drag.x; view.panY = drag.panY + event.clientY - drag.y; map.draw();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault(); const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left, y = event.clientY - rect.top, anchor = screenToGrid(x, y);
    if (!anchor) return;
    view.zoom = Math.max(0.8, Math.min(8, view.zoom * Math.exp(-event.deltaY * 0.001)));
    const moved = gridToScreen(anchor.x, anchor.y); view.panX += x - moved.x; view.panY += y - moved.y; map.draw();
  }, { passive: false });
  new ResizeObserver(() => map.draw()).observe(canvas);
  map.draw(); map.firstFrameMs = performance.now() - started;
  return map;
}

export function channelAt(grid: SoundGrid, x: number, y: number): { road: number; rail: number } {
  const col = Math.max(0, Math.min(grid.width - 1, Math.floor(x * grid.width)));
  const row = Math.max(0, Math.min(grid.height - 1, Math.floor(y * grid.height)));
  const index = row * grid.width + col;
  return { road: grid.roads[index]!, rail: grid.rails[index]! };
}
