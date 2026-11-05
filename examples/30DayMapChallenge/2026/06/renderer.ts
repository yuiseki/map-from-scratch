import { countryTint, projectVintage, type Coordinate } from './vintage.ts';
type Country = { id: string; polygons: Coordinate[][][] };
type Stats = { features: number; countries: number; rings: number; vertices: number };
const PAPER = '#ead9b3';

export async function mount(canvas: HTMLCanvasElement, base: string) {
  const startedAt = performance.now();
  const [countries, stats] = await Promise.all(['countries.json', 'stats.json'].map(async (name) => {
    const response = await fetch(`${base}/${name}`);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.json();
  })) as [Country[], Stats];
  if (countries.length !== stats.countries) throw new Error('Country mesh and statistics disagree');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is not available');
  const countryPaths = countries.map((country) => {
    const path = new Path2D();
    for (const polygon of country.polygons) for (const ring of polygon) {
      ring.forEach(([x, y], i) => { if (!i) path.moveTo(x / 65535, y / 65535); else path.lineTo(x / 65535, y / 65535); });
      path.closePath();
    }
    return { path, color: countryTint(hash(country.id)) };
  });
  const landPath = new Path2D();
  for (const { path } of countryPaths) landPath.addPath(path);
  const state = { zoom: 1, panX: 0, panY: 0 };
  let drag: [number, number] | null = null;
  const screen = (lon: number, lat: number): [number, number] => {
    const s = Math.min(canvas.width / (360 * 1.08), canvas.height / (180 * 1.12)) * state.zoom;
    const [x, y] = projectVintage(lon, lat);
    return [canvas.width / 2 + (x - 0.5) * 360 * s + state.panX, canvas.height / 2 + (y - 0.5) * 180 * s + state.panY];
  };
  function draw() {
    const w = canvas.width, h = canvas.height;
    ctx!.fillStyle = PAPER; ctx!.fillRect(0, 0, w, h);
    const s = Math.min(w / (360 * 1.08), h / (180 * 1.12)) * state.zoom;
    const left = w / 2 - 180 * s + state.panX, top = h / 2 - 90 * s + state.panY;
    // Engraved graticule, clipped to the neatline.
    const pixelToWorld = 1 / (360 * s);
    ctx!.save(); ctx!.beginPath(); ctx!.rect(left, top, 360 * s, 180 * s); ctx!.clip();
    ctx!.setTransform(360 * s, 0, 0, 180 * s, left, top);
    ctx!.strokeStyle = '#806d4b50'; ctx!.lineWidth = 0.55 * devicePixelRatio * pixelToWorld;
    for (let lon = 0; lon <= 1; lon += 1 / 12) { ctx!.beginPath(); ctx!.moveTo(lon, 0); ctx!.lineTo(lon, 1); ctx!.stroke(); }
    for (let lat = 1 / 6; lat < 1; lat += 1 / 6) { ctx!.beginPath(); ctx!.moveTo(0, lat); ctx!.lineTo(1, lat); ctx!.stroke(); }
    countryPaths.forEach(({ path, color }) => {
      ctx!.fillStyle = color; ctx!.fill(path, 'evenodd');
      ctx!.strokeStyle = '#66573d'; ctx!.lineWidth = 0.6 * devicePixelRatio * pixelToWorld; ctx!.stroke(path);
    });
    ctx!.save(); ctx!.clip(landPath, 'evenodd');
    ctx!.globalAlpha = 0.14; ctx!.strokeStyle = '#55462e'; ctx!.lineWidth = 0.45 * devicePixelRatio * pixelToWorld;
    const spacing = Math.max(0.004, 9 * devicePixelRatio * pixelToWorld);
    for (let x = -0.5; x < 1; x += spacing) { ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x + 0.5, 1); ctx!.stroke(); }
    ctx!.restore(); ctx!.restore();
    // Paper grain is deterministic and sparse to keep the static canvas cheap.
    let seed = 202606;
    for (let i = 0; i < Math.floor(w * h / 1300); i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed % w; seed = (seed * 1664525 + 1013904223) >>> 0; const y = seed % h;
      ctx!.fillStyle = (seed & 3) === 0 ? '#624c2c18' : '#fff9e41c'; ctx!.fillRect(x, y, 1.2 * devicePixelRatio, 1.2 * devicePixelRatio);
    }
    ctx!.strokeStyle = '#806d4b'; ctx!.lineWidth = 1.2 * devicePixelRatio; ctx!.strokeRect(14 * devicePixelRatio, 14 * devicePixelRatio, w - 28 * devicePixelRatio, h - 28 * devicePixelRatio);
  }
  const resize = () => { canvas.width = Math.round(canvas.clientWidth * devicePixelRatio); canvas.height = Math.round(canvas.clientHeight * devicePixelRatio); draw(); };
  canvas.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY]; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { drag = null; }); canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointermove', (e) => { if (!drag) return; state.panX += (e.clientX - drag[0]) * devicePixelRatio; state.panY += (e.clientY - drag[1]) * devicePixelRatio; drag = [e.clientX, e.clientY]; draw(); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); state.zoom = Math.max(0.65, Math.min(7, state.zoom * Math.exp(-e.deltaY * 0.001))); draw(); }, { passive: false });
  new ResizeObserver(resize).observe(canvas); resize();
  return { stats, draw, state, screen, firstFrameMs: performance.now() - startedAt };
}

export type VintageMap = Awaited<ReturnType<typeof mount>>;

function hash(text: string): number { let value = 0; for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) | 0; return value; }
