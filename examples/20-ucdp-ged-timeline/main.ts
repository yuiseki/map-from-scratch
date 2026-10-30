// Year-sliced GED points, drawn only when the year, camera or filter changes.
export {};
interface Point { x: number; y: number; deaths: number; id: number; day: number; type: number; precision: number; country: number }
interface Summary { events: number[]; deaths: number[] }
interface Meta { release: string; start: number; end: number; years: Record<string, Summary>; countries: Record<string, string> }
const ROOT = '../../data/baked/20-ucdp-ged-timeline';
const canvas = document.getElementById('map') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const summary = document.getElementById('summary')!;
const detail = document.getElementById('detail')!;
const yearLabel = document.getElementById('year')!;
const slider = document.getElementById('slider') as HTMLInputElement;
const play = document.getElementById('play') as HTMLButtonElement;
const bars = document.getElementById('bars')!;
const fmt = new Intl.NumberFormat('ja-JP');
const COLORS = ['', '#ebaa6d', '#75bdc4', '#d989a8'];
const TYPE = ['', '国家を含む紛争', '非国家間の紛争', '一方的な暴力'];
let meta: Meta, land: Path2D, points: Point[] = [], year = 2025;
let width = 1, height = 1, base = 1, scale = 1, factor = 1, ox = 0, oy = 0;
let selected: Point | null = null, loadToken = 0, playing = false;
const visible = [false, true, true, true];
const cache = new Map<number, Promise<Point[]>>();

function decode(buffer: ArrayBuffer): Point[] {
  const data = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'GED1') throw new Error('GED data version mismatch');
  const count = data.getUint32(4, true);
  if (buffer.byteLength !== 8 + count * 18) throw new Error('GED data size mismatch');
  const rows: Point[] = [];
  for (let i = 0, at = 8; i < count; i++, at += 18) rows.push({
    x: data.getUint16(at, true), y: data.getUint16(at + 2, true), deaths: data.getUint32(at + 4, true),
    id: data.getUint32(at + 8, true), day: data.getUint16(at + 12, true), type: data.getUint8(at + 14),
    precision: data.getUint8(at + 15), country: data.getUint16(at + 16, true),
  });
  return rows;
}

function getYear(y: number): Promise<Point[]> {
  if (!cache.has(y)) cache.set(y, fetch(`${ROOT}/${y}.bin`).then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.arrayBuffer();
  }).then(decode).catch((error) => { cache.delete(y); throw error; }));
  return cache.get(y)!;
}

function draw() {
  const dpr = devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#101c27'; ctx.fillRect(0, 0, width, height);
  if (land) {
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, ox * dpr, oy * dpr);
    ctx.fillStyle = '#263844'; ctx.fill(land);
    ctx.strokeStyle = '#435461'; ctx.lineWidth = 0.7 / scale; ctx.stroke(land);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 0.58;
  for (const p of points) {
    if (!visible[p.type]) continue;
    const x = ox + p.x * scale, y = oy + p.y * scale;
    if (x < -10 || x > width + 10 || y < -10 || y > height + 10) continue;
    ctx.fillStyle = COLORS[p.type];
    const radius = 1.45 + Math.min(5.5, Math.log2(p.deaths + 1) * 0.36);
    if (radius < 2.2) ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    else { ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.globalAlpha = 1;
  if (selected) {
    const x = ox + selected.x * scale, y = oy + selected.y * scale;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
  }
}

function resize() {
  const rect = canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
  width = rect.width; height = rect.height;
  canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
  base = Math.min(width, height) / 65535;
  scale = base * factor;
  draw();
}

function focus(lon: number, lat: number, zoom: number) {
  factor = zoom; scale = base * factor;
  const sine = Math.sin(lat * Math.PI / 180);
  const x = (lon + 180) / 360 * 65535;
  const y = (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * 65535;
  ox = width / 2 - x * scale; oy = height / 2 - y * scale;
  draw();
}

function zoomAt(multiplier: number, x: number, y: number) {
  const next = Math.max(1, Math.min(100, factor * multiplier));
  const ratio = next / factor;
  ox = x - (x - ox) * ratio; oy = y - (y - oy) * ratio;
  factor = next; scale = base * factor;
  draw();
}

function showDetails(p: Point | null) {
  detail.replaceChildren();
  const title = document.createElement('strong'), note = document.createElement('small');
  if (p) {
    const date = new Date(Date.UTC(year, 0, 1 + p.day)).toISOString().slice(0, 10);
    title.textContent = `${meta.countries[p.country] ?? '国名不明'} · ${date}`;
    note.textContent = `${TYPE[p.type]} / 死者数 best 推計 ${fmt.format(p.deaths)} 人 / 位置精度コード ${p.precision} / UCDP ID ${p.id}`;
  } else { title.textContent = '点を選択'; note.textContent = '点をクリックすると出来事の情報を表示します'; }
  detail.append(title, note);
}

function showSummary() {
  const s = meta.years[year];
  const count = s.events.reduce((n, value, i) => n + (visible[i + 1] ? value : 0), 0);
  const deaths = s.deaths.reduce((n, value, i) => n + (visible[i + 1] ? value : 0), 0);
  summary.querySelector('strong')!.textContent = `${fmt.format(count)} 件`;
  summary.querySelector('small')!.textContent = `UCDP GED ${meta.release} · ${year}年`;
  summary.querySelector('.figures')!.textContent = `死者数 best 推計 ${fmt.format(deaths)} 人`;
  yearLabel.textContent = String(year);
  slider.value = String(year);
  bars.querySelectorAll('button').forEach((button) => button.classList.toggle('active', Number(button.getAttribute('data-year')) === year));
}

async function setYear(next: number) {
  year = next;
  const token = ++loadToken;
  selected = null;
  showDetails(null);
  showSummary();
  points = [];
  draw();
  try {
    const loaded = await getYear(next);
    if (token !== loadToken) return;
    points = loaded;
    draw();
    if (next < meta.end) void getYear(next + 1).catch(() => {});
  } catch (error) {
    if (token === loadToken) summary.querySelector('strong')!.textContent = `読み込み失敗: ${String(error)}`;
  }
}

let timer = 0;
function stop() { playing = false; clearTimeout(timer); play.textContent = '再生'; }
play.addEventListener('click', () => {
  if (playing) { stop(); return; }
  playing = true; play.textContent = '停止';
  const tick = () => {
    if (!playing) return;
    void setYear(year >= meta.end ? meta.start : year + 1);
    timer = window.setTimeout(tick, 750);
  };
  timer = window.setTimeout(tick, 750);
});
slider.addEventListener('input', () => { stop(); void setYear(Number(slider.value)); });
document.querySelectorAll<HTMLInputElement>('[data-type]').forEach((input) => input.addEventListener('change', () => {
  visible[Number(input.dataset.type)] = input.checked;
  if (meta) showSummary();
  draw();
}));
const places: Record<string, [number, number, number]> = {
  world: [8, 0, 1], ukraine: [31, 49, 12], sudan: [30, 15, 12], 'middle-east': [43, 31, 10],
};
document.querySelectorAll<HTMLButtonElement>('[data-place]').forEach((button) => button.addEventListener('click', () => focus(...places[button.dataset.place!])));
document.getElementById('plus')!.addEventListener('click', () => zoomAt(1.8, width / 2, height / 2));
document.getElementById('minus')!.addEventListener('click', () => zoomAt(1 / 1.8, width / 2, height / 2));
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  zoomAt(Math.exp(-event.deltaY * 0.0014), event.clientX - rect.left, event.clientY - rect.top);
}, { passive: false });
// sx, sy: where the press started; a click survives 3 px of movement from it.
let drag: { id: number; x: number; y: number; sx: number; sy: number; moved: boolean } | null = null;
canvas.addEventListener('pointerdown', (event) => { canvas.setPointerCapture(event.pointerId); drag = { id: event.pointerId, x: event.clientX, y: event.clientY, sx: event.clientX, sy: event.clientY, moved: false }; });
canvas.addEventListener('pointermove', (event) => {
  if (drag?.id !== event.pointerId) return;
  const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
  if (Math.hypot(event.clientX - drag.sx, event.clientY - drag.sy) > 3) drag.moved = true;
  ox += dx; oy += dy; drag.x = event.clientX; drag.y = event.clientY;
  draw();
});
canvas.addEventListener('pointerup', (event) => {
  if (drag?.id !== event.pointerId) return;
  const moved = drag.moved; drag = null;
  if (moved) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left, y = event.clientY - rect.top;
  let nearest: Point | null = null, best = 11 * 11;
  for (const p of points) {
    if (!visible[p.type]) continue;
    const dx = ox + p.x * scale - x, dy = oy + p.y * scale - y;
    const distance = dx * dx + dy * dy;
    if (distance < best) { best = distance; nearest = p; }
  }
  selected = nearest; showDetails(nearest); draw();
});
new ResizeObserver(resize).observe(canvas);

try {
  const [metaResponse, landResponse] = await Promise.all([fetch(`${ROOT}/meta.json`), fetch(`${ROOT}/land.json`)]);
  if (!metaResponse.ok || !landResponse.ok) throw new Error(`HTTP ${metaResponse.status}/${landResponse.status}`);
  meta = await metaResponse.json() as Meta;
  land = new Path2D(await landResponse.json() as string);
  const max = Math.max(...Object.values(meta.years).map((s) => s.deaths.reduce((a, b) => a + b, 0)));
  for (let y = meta.start; y <= meta.end; y++) {
    const button = document.createElement('button');
    const deaths = meta.years[y].deaths.reduce((a, b) => a + b, 0);
    button.style.setProperty('--h', `${Math.max(10, Math.round(Math.sqrt(deaths / max) * 100))}%`);
    button.title = `${y}年 · 死者数 best 推計 ${fmt.format(deaths)} 人`;
    button.setAttribute('data-year', String(y));
    button.setAttribute('aria-label', button.title);
    button.addEventListener('click', () => { stop(); void setYear(y); });
    bars.append(button);
  }
  resize(); focus(...places.world);
  await setYear(meta.end);
} catch (error) {
  summary.querySelector('strong')!.textContent = `データを読み込めませんでした: ${String(error)}`;
}
