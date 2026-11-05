interface Stats {
  sourceDate: string; sourceWays: number; graphNodes: number; graphEdges: number; reachedNodes: number;
  reachableSegments: number; unreachableSegments: number; originName: string; originMercator: [number, number];
  originSnapMeters: number; walkMinutes: number; walkingSpeedMps: number; bounds: { minX: number; minY: number; maxX: number; maxY: number };
}
const EXTENT = 2_600;
const COLORS = ['#7de3c0', '#a4dc8a', '#f0d26f', '#f4a568', '#ec7882'];

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [binary, stats] = await Promise.all(['walkshed.bin', 'stats.json'].map(async (name) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return name.endsWith('.json') ? response.json() : response.arrayBuffer();
  })) as [ArrayBuffer, Stats];
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) throw new Error('Canvas 2D is not available');
  const view = new DataView(binary);
  if (String.fromCharCode(...new Uint8Array(binary, 0, 4)) !== 'W10M') throw new Error('Unsupported walkshed signature');
  const count = view.getUint32(4, true), expectedBytes = 44 + count * 12;
  if (binary.byteLength !== expectedBytes || count !== stats.reachableSegments + stats.unreachableSegments) throw new Error('Walk graph and statistics disagree');
  const unreachable = new Path2D(), reached = COLORS.map(() => new Path2D()), reachedAll = new Path2D();
  for (let i = 0, offset = 44; i < count; i++, offset += 12) {
    const x0 = view.getUint16(offset, true) / 65535, y0 = view.getUint16(offset + 2, true) / 65535;
    const x1 = view.getUint16(offset + 4, true) / 65535, y1 = view.getUint16(offset + 6, true) / 65535;
    const t0 = view.getUint8(offset + 8), t1 = view.getUint8(offset + 9);
    const path = t0 === 255 || t1 === 255 ? unreachable : reached[Math.min(4, Math.floor((t0 + t1) / 2 / 255 * 5))]!;
    path.moveTo(x0, y0); path.lineTo(x1, y1);
    if (path !== unreachable) { reachedAll.moveTo(x0, y0); reachedAll.lineTo(x1, y1); }
  }
  const state = { zoom: 1, panX: 0, panY: 0 };
  let drag: [number, number] | null = null;
  const screen = (point: [number, number]): [number, number] => {
    const { minX, maxY } = stats.bounds;
    const s = Math.min(canvas.width, canvas.height) / EXTENT * state.zoom;
    const x = (point[0] - minX) / EXTENT, y = (maxY - point[1]) / EXTENT;
    const left = canvas.width / 2 - EXTENT * s / 2 + state.panX, top = canvas.height / 2 - EXTENT * s / 2 + state.panY;
    return [left + x * EXTENT * s, top + y * EXTENT * s];
  };
  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx!.fillStyle = '#0c1420'; ctx!.fillRect(0, 0, w, h);
    const s = Math.min(w, h) / EXTENT * state.zoom;
    const left = w / 2 - EXTENT * s / 2 + state.panX, top = h / 2 - EXTENT * s / 2 + state.panY;
    ctx!.save(); ctx!.beginPath(); ctx!.rect(left, top, EXTENT * s, EXTENT * s); ctx!.clip();
    ctx!.setTransform(EXTENT * s, 0, 0, EXTENT * s, left, top);
    ctx!.lineCap = 'round'; ctx!.lineJoin = 'round';
    const px = 1 / (EXTENT * s);
    ctx!.strokeStyle = '#607287'; ctx!.globalAlpha = 0.52; ctx!.lineWidth = 1.15 * px; ctx!.stroke(unreachable);
    ctx!.globalAlpha = 0.18; ctx!.lineWidth = 6 * px; ctx!.strokeStyle = '#f8b976'; ctx!.stroke(reachedAll);
    ctx!.globalAlpha = 0.98; ctx!.lineWidth = 1.8 * px;
    reached.forEach((path, index) => { ctx!.strokeStyle = COLORS[index]!; ctx!.stroke(path); });
    ctx!.restore();
    ctx!.strokeStyle = '#9fb1c055'; ctx!.lineWidth = Math.max(1, devicePixelRatio); ctx!.strokeRect(16 * devicePixelRatio, 16 * devicePixelRatio, w - 32 * devicePixelRatio, h - 32 * devicePixelRatio);
    const [ox, oy] = screen(stats.originMercator);
    ctx!.beginPath(); ctx!.arc(ox, oy, 13 * devicePixelRatio, 0, Math.PI * 2); ctx!.fillStyle = '#f4f0e3'; ctx!.fill();
    ctx!.beginPath(); ctx!.arc(ox, oy, 9 * devicePixelRatio, 0, Math.PI * 2); ctx!.fillStyle = '#e4545e'; ctx!.fill();
    ctx!.beginPath(); ctx!.arc(ox, oy, 3 * devicePixelRatio, 0, Math.PI * 2); ctx!.fillStyle = '#fff8e9'; ctx!.fill();
  }
  const resize = () => { canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio); draw(); };
  canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; state.panX += (e.clientX - drag[0]) * devicePixelRatio; state.panY += (e.clientY - drag[1]) * devicePixelRatio; drag = [e.clientX, e.clientY]; draw(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = Math.max(0.65, Math.min(6, state.zoom * Math.exp(-e.deltaY * 0.001))); draw(); }, { passive: false });
  new ResizeObserver(resize).observe(canvas); resize();
  return { stats, state, draw, screen, canvas, context: ctx, firstFrameMs: performance.now() - startedAt };
}

export type WalkMap = Awaited<ReturnType<typeof mount>>;
